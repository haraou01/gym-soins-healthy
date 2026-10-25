import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

import { metrics } from '../observability/metrics.registry';
import { RetentionService } from './retention.service';

const RETENTION_ADVISORY_LOCK_KEY = 728_341_902;

export interface RetentionRunResult {
  skipped: boolean;
  reason?: 'already_running' | 'locked';
  idempotencyKeysPurged?: number;
  outboxEventsPurged?: number;
  durationMs?: number;
}

@Injectable()
export class RetentionWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RetentionWorkerService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private lastRunAt: Date | null = null;
  private lastSuccessAt: Date | null = null;
  private lastError: string | null = null;
  private lastResult: RetentionRunResult | null = null;

  constructor(
    private readonly retentionService: RetentionService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    const enabled = this.isEnabled();

    metrics.setGauge('retention_worker_up', enabled ? 1 : 0);
    metrics.setGauge(
      'retention_worker_heartbeat_timestamp_seconds',
      Date.now() / 1_000,
    );

    if (!enabled) {
      this.logger.log('Purge de rétention désactivée par configuration.');
      return;
    }

    const rawInterval = Number(
      this.configService.get<string | number>('RETENTION_PURGE_INTERVAL_MS'),
    );
    const intervalMs =
      Number.isFinite(rawInterval) && rawInterval > 0
        ? rawInterval
        : 21_600_000;

    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }

    metrics.setGauge('retention_worker_up', 0);
  }

  /**
   * Exécution manuelle/schedulée protégée par un verrou PostgreSQL global.
   * Plusieurs instances peuvent tourner : une seule exécute la purge.
   */
  async runNow(): Promise<RetentionRunResult> {
    if (this.running) {
      metrics.inc('retention_purge_runs_total', { result: 'already_running' });
      return { skipped: true, reason: 'already_running' };
    }

    this.running = true;
    const startedAt = Date.now();
    const queryRunner = this.dataSource.createQueryRunner();
    let lockAcquired = false;

    try {
      await queryRunner.connect();
      const rows = await queryRunner.query(
        'SELECT pg_try_advisory_lock($1) AS locked',
        [RETENTION_ADVISORY_LOCK_KEY],
      );
      lockAcquired = rows[0]?.locked === true;

      if (!lockAcquired) {
        metrics.inc('retention_purge_runs_total', { result: 'locked' });
        metrics.inc('retention_purge_skipped_locked_total');
        return { skipped: true, reason: 'locked' };
      }

      const result = await this.retentionService.runAll();
      const durationMs = Date.now() - startedAt;

      this.lastRunAt = new Date();
      this.lastSuccessAt = this.lastRunAt;
      this.lastError = null;
      this.lastResult = {
        skipped: false,
        ...result,
        durationMs,
      };

      metrics.inc('retention_purge_runs_total', { result: 'success' });
      metrics.setGauge(
        'retention_last_success_timestamp_seconds',
        this.lastSuccessAt.getTime() / 1_000,
      );
      metrics.setGauge(
        'retention_worker_heartbeat_timestamp_seconds',
        Date.now() / 1_000,
      );

      return this.lastResult;
    } catch (error) {
      this.lastRunAt = new Date();
      this.lastError = error instanceof Error ? error.message : String(error);
      this.lastResult = {
        skipped: false,
        durationMs: Date.now() - startedAt,
      };

      metrics.inc('retention_purge_runs_total', { result: 'error' });
      metrics.inc('retention_purge_errors_total');
      metrics.setGauge(
        'retention_worker_heartbeat_timestamp_seconds',
        Date.now() / 1_000,
      );

      this.logger.error(`Erreur de purge de rétention: ${this.lastError}`);
      throw error;
    } finally {
      if (lockAcquired) {
        try {
          await queryRunner.query('SELECT pg_advisory_unlock($1)', [
            RETENTION_ADVISORY_LOCK_KEY,
          ]);
        } catch {
          // La libération est aussi assurée par la fermeture de la connexion.
        }
      }
      await queryRunner.release();
      this.running = false;
    }
  }

  getStatus() {
    return {
      enabled: this.isEnabled(),
      running: this.running,
      lastRunAt: this.lastRunAt?.toISOString() ?? null,
      lastSuccessAt: this.lastSuccessAt?.toISOString() ?? null,
      lastError: this.lastError,
      lastResult: this.lastResult,
    };
  }

  private async tick(): Promise<void> {
    metrics.inc('retention_purge_ticks_total');

    try {
      await this.runNow();
    } catch {
      // runNow journalise et incrémente déjà les métriques.
    }
  }

  private isEnabled(): boolean {
    const raw = this.configService.get<boolean | string>(
      'RETENTION_PURGE_ENABLED',
    );

    return raw === true || raw === 'true';
  }
}
