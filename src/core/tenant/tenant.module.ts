import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Tenant, TenantMembership } from './entities';
import { TenantContextInterceptor } from './tenant-context.interceptor';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Tenant, TenantMembership])],
  controllers: [TenantController],
  providers: [
    TenantService,
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantContextInterceptor,
    },
  ],
  exports: [TenantService],
})
export class TenantModule {}
