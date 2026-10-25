import { Global, Module } from '@nestjs/common';

import { OutboxController } from './outbox.controller';
import { OutboxService } from './outbox.service';
import { OutboxWorkerService } from './outbox.worker';

@Global()
@Module({
  controllers: [OutboxController],
  providers: [OutboxService, OutboxWorkerService],
  exports: [OutboxService],
})
export class OutboxModule {}
