import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  SpanKind,
  SpanStatusCode,
  context as otelContext,
  trace as otelTrace,
} from '@opentelemetry/api';
import { DataSource, EntityManager } from 'typeorm';

import { metrics } from '../observability/metrics.registry';
import { writeJsonLog } from '../observability/json-logger';
import {
  createChildTraceContext,
  createTraceContext,
  getTraceContext,
  runWithTraceContext,
} from '../tracing';

export type OutboxStatus = 'PENDING' | 'PROCESSING' | 'PROCESSED' | 'FAILED';

export interface AppendOutboxEventInput {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: unknown;
}

export interface OutboxEvent {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: unknown;
  status: OutboxStatus;
  attempts: number;
  availableAt: Date;
  processedAt: Date | null;
  lastError: string | null;
  traceId?: string | null;
  spanId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OutboxStats {
  PENDING: number;
  PROCESSING: number;
  PROCESSED: number;
  FAILED: number;
}

@Injectable()
export class OutboxService {
  private readonly tracer = otelTrace.getTracer('gymsoins-outbox');
  private readonly maxAttempts: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly lockTimeoutMs: number;
  private readonly batchSize: number;

  constructor(
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly configService: ConfigService,
  ) {
    this.maxAttempts = this.readNumber('OUTBOX_MAX_ATTEMPTS', 10);
    this.baseBackoffMs = this.readNumber('OUTBOX_BASE_BACKOFF_MS', 5_000);
    this.maxBackoffMs = this.readNumber('OUTBOX_MAX_BACKOFF_MS', 300_000);
    this.lockTimeoutMs = this.readNumber('OUTBOX_LOCK_TIMEOUT_MS', 300_000);
    this.batchSize = this.readNumber('OUTBOX_BATCH_SIZE', 20);
  }

  /**
   * Écrit l'événement dans la transaction métier courante.
   * L'appelant doit fournir l'EntityManager de sa transaction.
   */
  async append(
    manager: EntityManager,
    input: AppendOutboxEventInput,
  ): Promise<string> {
    const trace = getTraceContext();
    const span = this.tracer.startSpan('outbox.append', {
      kind: SpanKind.PRODUCER,
      attributes: {
        'messaging.system': 'postgresql',
        'messaging.operation': 'publish',
        'messaging.destination.name': 'outbox_events',
        'gymsoins.event_type': input.eventType,
        'gymsoins.aggregate_type': input.aggregateType,
        'gymsoins.aggregate_id': input.aggregateId,
      },
    });

    try {
      const rows = await manager.query(
        `
          INSERT INTO "outbox_events"
            ("eventType", "aggregateType", "aggregateId", "payload", "status", "traceId", "spanId")
          VALUES ($1, $2, $3, $4::jsonb, 'PENDING', $5, $6)
          RETURNING "id"
        `,
        [
          input.eventType,
          input.aggregateType,
          input.aggregateId,
          JSON.stringify(input.payload) ?? 'null',
          trace?.traceId ?? null,
          trace?.spanId ?? null,
        ],
      );

      span.setStatus({ code: SpanStatusCode.OK });
      return rows[0].id;
    } catch (error) {
      span.recordException(
        error instanceof Error ? error : new Error(String(error)),
      );
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Traitement immédiat après commit (optimisation de latence).
   * En cas d'échec, l'événement reste en base et sera repris par le worker.
   */
  async dispatchOne(id: string): Promise<boolean> {
    const event = await this.claimOne(id);

    if (event) {
      await this.processClaimed(event);
      return true;
    }

    // Un worker a peut-être déjà pris l'événement : attendre brièvement
    // son passage à PROCESSED pour conserver une livraison quasi immédiate.
    return this.waitForProcessed(id, 2_000);
  }

  /**
   * Récupère un lot avec verrouillage PostgreSQL `FOR UPDATE SKIP LOCKED`.
   * Plusieurs workers peuvent tourner sans traiter le même événement.
   */
  async processBatch(): Promise<number> {
    await this.recoverStaleEvents();

    const events = this.extractRows<OutboxEvent>(
      await this.dataSource.transaction(async (manager) => {
        return manager.query(
          `
            WITH candidates AS (
              SELECT "id"
              FROM "outbox_events"
              WHERE "status" = 'PENDING'
                AND "availableAt" <= NOW()
              ORDER BY "createdAt" ASC
              LIMIT $1
              FOR UPDATE SKIP LOCKED
            )
            UPDATE "outbox_events" event
            SET "status" = 'PROCESSING',
                "attempts" = event."attempts" + 1,
                "updatedAt" = NOW()
            FROM candidates
            WHERE event."id" = candidates."id"
            RETURNING event.*
          `,
          [this.batchSize],
        );
      }),
    );

    for (const event of events) {
      await this.processClaimed(event);
    }

    return events.length;
  }

  async getStats(): Promise<OutboxStats> {
    const rows: Array<{ status: OutboxStatus; count: string }> =
      await this.dataSource.query(
        `
          SELECT "status", COUNT(*)::text AS "count"
          FROM "outbox_events"
          GROUP BY "status"
        `,
      );

    const stats: OutboxStats = {
      PENDING: 0,
      PROCESSING: 0,
      PROCESSED: 0,
      FAILED: 0,
    };

    for (const row of rows) {
      stats[row.status] = Number(row.count);
    }

    return stats;
  }

  async findFailed(limit = 100): Promise<OutboxEvent[]> {
    return this.dataSource.query(
      `
        SELECT *
        FROM "outbox_events"
        WHERE "status" = 'FAILED'
        ORDER BY "updatedAt" DESC
        LIMIT $1
      `,
      [limit],
    );
  }

  async findById(id: string): Promise<OutboxEvent | null> {
    const rows = await this.dataSource.query(
      'SELECT * FROM "outbox_events" WHERE "id" = $1',
      [id],
    );

    return rows[0] ?? null;
  }

  /** Remet un événement FAILED en file d'attente. */
  async requeueFailed(id: string): Promise<OutboxEvent | null> {
    const result = await this.dataSource.query(
      `
        UPDATE "outbox_events"
        SET "status" = 'PENDING',
            "attempts" = 0,
            "availableAt" = NOW(),
            "processedAt" = NULL,
            "lastError" = NULL,
            "updatedAt" = NOW()
        WHERE "id" = $1 AND "status" = 'FAILED'
        RETURNING *
      `,
      [id],
    );

    const rows = this.extractRows<OutboxEvent>(result);
    return rows[0] ?? null;
  }

  private async claimOne(id: string): Promise<OutboxEvent | null> {
    const result = await this.dataSource.transaction(async (manager) => {
      return manager.query(
        `
          WITH candidate AS (
            SELECT "id"
            FROM "outbox_events"
            WHERE "id" = $1
              AND "status" = 'PENDING'
              AND "availableAt" <= NOW()
            FOR UPDATE SKIP LOCKED
          )
          UPDATE "outbox_events" event
          SET "status" = 'PROCESSING',
              "attempts" = event."attempts" + 1,
              "updatedAt" = NOW()
          FROM candidate
          WHERE event."id" = candidate."id"
          RETURNING event.*
        `,
        [id],
      );
    });

    const rows = this.extractRows<OutboxEvent>(result);
    return rows[0] ?? null;
  }

  private async processClaimed(event: OutboxEvent): Promise<void> {
    const rootContext = event.traceId
      ? {
          traceId: event.traceId,
          spanId: event.spanId ?? createTraceContext().spanId,
        }
      : createTraceContext();
    const context = event.traceId
      ? createChildTraceContext(rootContext)
      : rootContext;
    const startedAt = Date.now();

    const parentContext = event.traceId
      ? otelTrace.setSpanContext(otelContext.active(), {
          traceId: event.traceId,
          spanId: rootContext.spanId,
          traceFlags: 1,
        })
      : otelContext.active();

    await this.tracer.startActiveSpan(
      'outbox.process',
      {
        kind: SpanKind.CONSUMER,
        attributes: {
          'messaging.system': 'postgresql',
          'messaging.operation': 'process',
          'messaging.destination.name': 'outbox_events',
          'messaging.message.id': event.id,
          'gymsoins.event_type': event.eventType,
          'gymsoins.aggregate_type': event.aggregateType,
          'gymsoins.aggregate_id': event.aggregateId,
          'gymsoins.outbox.attempts': Number(event.attempts),
        },
      },
      parentContext,
      async (span) => {
        await runWithTraceContext(context, async () => {
          try {
            const payload =
              event.payload && typeof event.payload === 'object'
                ? { ...(event.payload as Record<string, unknown>) }
                : { data: event.payload };

            await this.eventEmitter.emitAsync(event.eventType, {
              ...payload,
              outboxEventId: event.id,
            });

            await this.markProcessed(event.id);
            metrics.inc('outbox_events_processed_total', {
              eventType: event.eventType,
            });
            span.setStatus({ code: SpanStatusCode.OK });
            writeJsonLog('info', 'outbox.event.processed', 'Outbox', {
              outboxEventId: event.id,
              eventType: event.eventType,
              aggregateType: event.aggregateType,
              aggregateId: event.aggregateId,
              traceId: context.traceId,
              spanId: context.spanId,
              parentSpanId: context.parentSpanId ?? null,
              durationMs: Date.now() - startedAt,
            });
          } catch (error) {
            span.recordException(
              error instanceof Error ? error : new Error(String(error)),
            );
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: error instanceof Error ? error.message : String(error),
            });
            writeJsonLog('warn', 'outbox.event.failed', 'Outbox', {
              outboxEventId: event.id,
              eventType: event.eventType,
              traceId: context.traceId,
              spanId: context.spanId,
              parentSpanId: context.parentSpanId ?? null,
              error: error instanceof Error ? error.message : String(error),
            });
            await this.markFailed(event, error);
          }
        });
        span.end();
      },
    );
  }

  private async markProcessed(id: string): Promise<void> {
    await this.dataSource.query(
      `
        UPDATE "outbox_events"
        SET "status" = 'PROCESSED',
            "processedAt" = NOW(),
            "lastError" = NULL,
            "updatedAt" = NOW()
        WHERE "id" = $1
      `,
      [id],
    );
  }

  private async markFailed(
    event: OutboxEvent,
    error: unknown,
  ): Promise<void> {
    const attempts = Number(event.attempts);
    const lastError = this.errorMessage(error).slice(0, 2_000);

    if (attempts >= this.maxAttempts) {
      await this.dataSource.query(
        `
          UPDATE "outbox_events"
          SET "status" = 'FAILED',
              "lastError" = $1,
              "updatedAt" = NOW()
          WHERE "id" = $2
        `,
        [lastError, event.id],
      );
      metrics.inc('outbox_events_failed_total', {
        eventType: event.eventType,
      });
      return;
    }

    const delayMs = Math.min(
      this.maxBackoffMs,
      this.baseBackoffMs * 2 ** Math.max(0, attempts - 1),
    );
    const availableAt = new Date(Date.now() + delayMs);

    await this.dataSource.query(
      `
        UPDATE "outbox_events"
        SET "status" = 'PENDING',
            "availableAt" = $1,
            "lastError" = $2,
            "updatedAt" = NOW()
        WHERE "id" = $3
      `,
      [availableAt, lastError, event.id],
    );
    metrics.inc('outbox_events_retried_total', {
      eventType: event.eventType,
    });
  }

  private async recoverStaleEvents(): Promise<void> {
    const cutoff = new Date(Date.now() - this.lockTimeoutMs);

    await this.dataSource.query(
      `
        UPDATE "outbox_events"
        SET "status" = 'PENDING',
            "availableAt" = NOW(),
            "lastError" = COALESCE("lastError", 'Worker lock timeout'),
            "updatedAt" = NOW()
        WHERE "status" = 'PROCESSING'
          AND "updatedAt" < $1
      `,
      [cutoff],
    );
  }

  private extractRows<T>(result: unknown): T[] {
    // TypeORM retourne [rows, affected] pour UPDATE/DELETE ... RETURNING.
    if (
      Array.isArray(result) &&
      result.length === 2 &&
      Array.isArray(result[0]) &&
      typeof result[1] === 'number'
    ) {
      return result[0] as T[];
    }

    return Array.isArray(result) ? (result as T[]) : [];
  }

  private async waitForProcessed(
    id: string,
    timeoutMs: number,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const rows = await this.dataSource.query(
        'SELECT "status" FROM "outbox_events" WHERE "id" = $1',
        [id],
      );
      const status = rows[0]?.status;

      if (status === 'PROCESSED') {
        return true;
      }

      if (status === 'FAILED') {
        return false;
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return false;
  }

  private readNumber(key: string, fallback: number): number {
    const raw = this.configService.get<string | number>(key);
    const value = Number(raw);

    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }
}
