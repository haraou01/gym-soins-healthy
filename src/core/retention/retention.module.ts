import { Global, Module } from '@nestjs/common';

import { RetentionService } from './retention.service';
import { RetentionWorkerService } from './retention.worker';

@Global()
@Module({
  providers: [RetentionService, RetentionWorkerService],
  exports: [RetentionService],
})
export class RetentionModule {}
