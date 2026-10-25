import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { MaintenanceController } from './controllers/maintenance.controller';
import { MaintenanceService } from './services/maintenance.service';
import { Equipment } from './entities/equipment.entity';
import { MaintenanceTicket } from './entities/maintenance-ticket.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Equipment, MaintenanceTicket])],
  controllers: [MaintenanceController],
  providers: [MaintenanceService],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
