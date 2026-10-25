import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CareController } from './controllers/care.controller';
import { CareService } from './services/care.service';
import { CareService as CareServiceEntity } from './entities/care-service.entity';
import { ClientCarePackage } from './entities/client-care-package.entity';
import { CareSession } from './entities/care-session.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([CareServiceEntity, ClientCarePackage, CareSession]),
  ],
  controllers: [CareController],
  providers: [CareService],
  exports: [CareService],
})
export class CareModule {}
