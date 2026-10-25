import {
  Injectable,
  Logger,
  MessageEvent,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Observable,
  Subject,
  defer,
  filter,
  finalize,
  interval,
  map,
  merge,
  of,
} from 'rxjs';
import { DataSource } from 'typeorm';

import {
  KITCHEN_ORDER_CREATED_EVENT,
  KITCHEN_ORDER_STATUS_CHANGED_EVENT,
} from '../../../core/events';
import { metrics } from '../../../core/observability/metrics.registry';

interface OutboxRealtimeRow {
  id: string;
  tenantId: string;
  eventType: string;
  payload: Record<string, unknown>;
  traceId: string | null;
  processedAt: Date;
}

interface KdsRealtimeEvent {
  id: string;
  type: string;
  tenantId: string;
  payload: Record<string, unknown>;
  traceId: string | null;
}

@Injectable()
export class KdsEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KdsEventsService.name);
  private readonly subject = new Subject<KdsRealtimeEvent>();
  private readonly seenEventIds = new Set<string>();
  private timer?: NodeJS.Timeout;
  private cursor = new Date();
  private polling = false;
  private activeConnections = 0;
  private pollErrors = 0;

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    metrics.setGauge('kds_sse_active_connections', 0);

    if (!this.isEnabled()) {
      this.logger.log('Polling KDS désactivé par configuration.');
      return;
    }

    this.timer = setInterval(() => {
      void this.pollOutbox();
    }, 1_000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.subject.complete();
  }

  stream(tenantId: string): Observable<MessageEvent> {
    return defer(() => {
      this.activeConnections += 1;
      metrics.inc('kds_sse_connections_total');
      metrics.setGauge(
        'kds_sse_active_connections',
        this.activeConnections,
      );

      return merge(
        of({
          data: {
            eventType: 'resync',
            timestamp: new Date().toISOString(),
          },
        } as MessageEvent),
        this.subject.pipe(
          filter((event) => event.tenantId === tenantId),
          map(
            (event) =>
              ({
                data: {
                  eventType: event.type,
                  eventId: event.id,
                  traceId: event.traceId,
                  payload: event.payload,
                },
              }) as MessageEvent,
          ),
        ),
        interval(15_000).pipe(
          map(
            () =>
              ({
                data: {
                  eventType: 'ping',
                  timestamp: new Date().toISOString(),
                },
              }) as MessageEvent,
          ),
        ),
      );
    }).pipe(
      finalize(() => {
        this.activeConnections = Math.max(0, this.activeConnections - 1);
        metrics.inc('kds_sse_disconnects_total');
        metrics.setGauge(
          'kds_sse_active_connections',
          this.activeConnections,
        );
      }),
    );
  }

  getActiveConnections(): number {
    return this.activeConnections;
  }

  getPollErrors(): number {
    return this.pollErrors;
  }

  private isEnabled(): boolean {
    const raw = this.configService.get<boolean | string>(
      'KDS_EVENTS_ENABLED',
    );

    return raw !== false && raw !== 'false';
  }

  private async pollOutbox(): Promise<void> {
    if (this.polling) {
      return;
    }

    this.polling = true;

    try {
      const rows: OutboxRealtimeRow[] = await this.dataSource.query(
        `SELECT "id", "tenantId", "eventType", payload, "traceId", "processedAt"
         FROM list_kds_outbox_events($1, 100)`,
        [this.cursor],
      );

      for (const row of rows) {
        if (this.seenEventIds.has(row.id)) {
          continue;
        }

        this.seenEventIds.add(row.id);
        this.subject.next({
          id: row.id,
          type: row.eventType,
          tenantId: String(row.tenantId),
          payload: row.payload ?? {},
          traceId: row.traceId,
        });
        metrics.inc('kds_events_published_total', {
          eventType: row.eventType,
        });
      }

      if (rows.length > 0) {
        this.cursor = new Date(rows[rows.length - 1].processedAt);
      }

      if (this.seenEventIds.size > 5_000) {
        const oldest = this.seenEventIds.values().next().value;
        if (oldest) {
          this.seenEventIds.delete(oldest);
        }
      }
    } catch {
      this.pollErrors += 1;
      metrics.inc('kds_poll_errors_total');
    } finally {
      this.polling = false;
    }
  }
}
