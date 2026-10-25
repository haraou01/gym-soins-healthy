import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { metrics } from '../observability/metrics.registry';
import { RetentionService } from './retention.service';

@Injectable()
export class RetentionWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RetentionWorkerService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly retentionService: RetentionService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    const enabled =
      this.configService.get<boolean | string>('RETENTION_PURGE_ENABLED') !==
        false &&
      this.configService.get<string>('RETENTION_PURGE_ENABLED') !== 'false';

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
  }

  private async tick(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    metrics.inc('retention_purge_ticks_total');

    try {
      await this.retentionService.runAll();
    } catch (error) {
      metrics.inc('retention_purge_errors_total');
      this.logger.error(
        `Erreur de purge de rétention: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      this.running = false;
    }
  }
}
