import { Global, Module } from '@nestjs/common';

import { HealthController } from './health.controller';
import { InternalMetricsController } from './internal-metrics.controller';
import { MetricsService } from './metrics.service';
import { ObservabilityController } from './observability.controller';

@Global()
@Module({
  controllers: [HealthController, InternalMetricsController, ObservabilityController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class ObservabilityModule {}
