import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { metrics } from '../observability/metrics.registry';
import { OutboxService } from './outbox.service';

@Injectable()
export class OutboxWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxWorkerService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly outboxService: OutboxService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    const enabled =
      this.configService.get<string>('OUTBOX_WORKER_ENABLED') !== 'false';

    if (!enabled) {
      metrics.setGauge('outbox_worker_up', 0);
      this.logger.log('Outbox worker désactivé par configuration.');
      return;
    }

    metrics.setGauge('outbox_worker_up', 1);
    metrics.setGauge(
      'outbox_worker_heartbeat_timestamp_seconds',
      Date.now() / 1_000,
    );

    const rawInterval = Number(
      this.configService.get<string | number>('OUTBOX_POLL_INTERVAL_MS'),
    );
    const intervalMs =
      Number.isFinite(rawInterval) && rawInterval > 0 ? rawInterval : 2_000;

    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);

    // Ne bloque pas la fin du processus (tests, scripts, CLI).
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }

    metrics.setGauge('outbox_worker_up', 0);
  }

  private async tick(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    metrics.inc('outbox_worker_ticks_total');
    metrics.setGauge(
      'outbox_worker_heartbeat_timestamp_seconds',
      Date.now() / 1_000,
    );

    try {
      const processed = await this.outboxService.processBatch();

      if (processed > 0) {
        this.logger.debug(`${processed} événement(s) outbox traité(s).`);
      }
    } catch (error) {
      metrics.inc('outbox_worker_errors_total');
      this.logger.error(
        `Erreur du worker outbox: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      this.running = false;
      metrics.setGauge(
        'outbox_worker_heartbeat_timestamp_seconds',
        Date.now() / 1_000,
      );
    }
  }
}
