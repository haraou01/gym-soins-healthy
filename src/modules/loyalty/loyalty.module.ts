import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LoyaltyController } from './controllers/loyalty.controller';
import { LoyaltyAccount, LoyaltyTransaction } from './entities';
import { SaleCompletedListener } from './listeners/sale-completed.listener';
import { LoyaltyService } from './services/loyalty.service';

@Module({
  imports: [TypeOrmModule.forFeature([LoyaltyAccount, LoyaltyTransaction])],
  controllers: [LoyaltyController],
  providers: [LoyaltyService, SaleCompletedListener],
  exports: [LoyaltyService],
})
export class LoyaltyModule {}
