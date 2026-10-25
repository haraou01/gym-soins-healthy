import {
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';

import { Roles, RolesGuard } from '../security';
import { RetentionWorkerService } from '../retention';
import { MetricsService } from './metrics.service';

@Controller('api/v1/observability')
@UseGuards(RolesGuard)
@Roles('SUPER_ADMIN')
export class ObservabilityController {
  constructor(
    private readonly metricsService: MetricsService,
    private readonly retentionWorker: RetentionWorkerService,
  ) {}

  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async getMetrics(): Promise<string> {
    return this.metricsService.render();
  }

  @Post('retention/run')
  @HttpCode(HttpStatus.OK)
  async runRetention() {
    return this.retentionWorker.runNow();
  }
}
