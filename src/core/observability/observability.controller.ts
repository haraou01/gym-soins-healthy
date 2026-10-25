import { Controller, Get, Header, UseGuards } from '@nestjs/common';

import { Roles, RolesGuard } from '../security';
import { MetricsService } from './metrics.service';

@Controller('api/v1/observability')
@UseGuards(RolesGuard)
@Roles('SUPER_ADMIN')
export class ObservabilityController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async getMetrics(): Promise<string> {
    return this.metricsService.render();
  }
}
