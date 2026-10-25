import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { GymController } from './controllers/gym.controller';
import { GymService } from './services/gym.service';
import { GymAccessService } from './services/gym-access.service';
import { Subscription } from './entities/subscription.entity';
import { AccessLog } from './entities/access-log.entity';
import { GroupClass } from './entities/group-class.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Subscription, AccessLog, GroupClass])],
  controllers: [GymController],
  providers: [GymService, GymAccessService],
  exports: [GymService, GymAccessService],
})
export class GymModule {}
