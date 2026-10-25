import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

import { writeJsonLog } from '../observability/json-logger';
import { metrics } from '../observability/metrics.registry';

@Injectable()
export class RetentionService {
  private readonly idempotencyRetentionDays: number;
  private readonly idempotencyBatchSize: number;
  private readonly outboxRetentionDays: number;
  private readonly outboxBatchSize: number;
  private readonly maxBatches: number;

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {
    this.idempotencyRetentionDays = this.readNumber(
      'IDEMPOTENCY_RETENTION_DAYS',
      30,
    );
    this.idempotencyBatchSize = this.readNumber(
      'IDEMPOTENCY_PURGE_BATCH_SIZE',
      500,
    );
    this.outboxRetentionDays = this.readNumber('OUTBOX_RETENTION_DAYS', 30);
    this.outboxBatchSize = this.readNumber('OUTBOX_PURGE_BATCH_SIZE', 500);
    this.maxBatches = this.readNumber('RETENTION_PURGE_MAX_BATCHES', 20);
  }

  async runAll(): Promise<{
    idempotencyKeysPurged: number;
    outboxEventsPurged: number;
  }> {
    const idempotencyKeysPurged = await this.purgeIdempotency();
    const outboxEventsPurged = await this.purgeOutbox();

    return { idempotencyKeysPurged, outboxEventsPurged };
  }

  /**
   * Purge par lots des clés d'idempotence COMPLETED expirées.
   *
   * - ne supprime jamais PROCESSING / FAILED ;
   * - `FOR UPDATE SKIP LOCKED` évite de bloquer les transactions actives ;
   * - plafonnée en nombre de lots pour ne pas monopoliser la base.
   */
  async purgeIdempotency(): Promise<number> {
    const cutoff = new Date(
      Date.now() - this.idempotencyRetentionDays * 24 * 60 * 60 * 1000,
    );
    let totalDeleted = 0;

    for (let batch = 0; batch < this.maxBatches; batch += 1) {
      // SECURITY DEFINER : nécessaire car le runtime app est sous RLS.
      const result = await this.dataSource.query(
        'SELECT purge_idempotency_batch($1, $2)::int AS deleted',
        [cutoff, this.idempotencyBatchSize],
      );

      const deleted = Number(result[0]?.deleted ?? 0);
      totalDeleted += deleted;

      if (deleted < this.idempotencyBatchSize) {
        break;
      }
    }

    if (totalDeleted > 0) {
      metrics.inc(
        'idempotency_keys_purged_total',
        {},
        totalDeleted,
      );
      writeJsonLog(
        'info',
        'retention.idempotency',
        'Retention',
        {
          deleted: totalDeleted,
          retentionDays: this.idempotencyRetentionDays,
          batchSize: this.idempotencyBatchSize,
        },
      );
    }

    return totalDeleted;
  }

  /**
   * Purge par lots des événements Outbox PROCESSED expirés.
   *
   * Les statuts PENDING / PROCESSING / FAILED ne sont jamais supprimés :
   * un FAILED doit rester récupérable via l'endpoint de reprise.
   */
  async purgeOutbox(): Promise<number> {
    const cutoff = new Date(
      Date.now() - this.outboxRetentionDays * 24 * 60 * 60 * 1000,
    );
    let totalDeleted = 0;

    for (let batch = 0; batch < this.maxBatches; batch += 1) {
      const result = await this.dataSource.query(
        'SELECT purge_outbox_batch($1, $2)::int AS deleted',
        [cutoff, this.outboxBatchSize],
      );

      const deleted = Number(result[0]?.deleted ?? 0);
      totalDeleted += deleted;

      if (deleted < this.outboxBatchSize) {
        break;
      }
    }

    if (totalDeleted > 0) {
      metrics.inc('outbox_events_purged_total', {}, totalDeleted);
      writeJsonLog(
        'info',
        'retention.outbox',
        'Retention',
        {
          deleted: totalDeleted,
          retentionDays: this.outboxRetentionDays,
          batchSize: this.outboxBatchSize,
        },
      );
    }

    return totalDeleted;
  }

  private readNumber(key: string, fallback: number): number {
    const raw = this.configService.get<string | number>(key);
    const value = Number(raw);

    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  private extractRows(result: unknown): unknown[] {
    if (
      Array.isArray(result) &&
      result.length === 2 &&
      Array.isArray(result[0]) &&
      typeof result[1] === 'number'
    ) {
      return result[0];
    }

    return Array.isArray(result) ? result : [];
  }
}
