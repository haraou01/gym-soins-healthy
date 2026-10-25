import {
  Controller,
  Get,
  Header,
  Headers,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Public } from '../security';
import { MetricsService } from './metrics.service';

/**
 * Endpoint de scrape Prometheus, séparé de l'endpoint admin.
 * Désactivé si METRICS_TOKEN n'est pas configuré.
 */
@Controller()
export class InternalMetricsController {
  constructor(
    private readonly metricsService: MetricsService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Get('internal/metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async metrics(@Headers('authorization') authorization?: string) {
    const expected = this.configService.get<string>('METRICS_TOKEN');

    if (!expected) {
      throw new NotFoundException();
    }

    if (authorization !== `Bearer ${expected}`) {
      throw new UnauthorizedException();
    }

    return this.metricsService.render();
  }
}
