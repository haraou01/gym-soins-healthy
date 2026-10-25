import './core/database/rls-query-guard';

import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  configSchema,
  jwtFactory,
  licenseFactory,
  postgresqlFactory,
} from './config';
import { LicenseModule } from './core/security/license.module';
import { SecurityModule } from './core/security/security.module';
import { IdempotencyModule } from './core/idempotency';
import { OutboxModule } from './core/outbox';
import { ObservabilityModule } from './core/observability';
import { RetentionModule } from './core/retention';
import { TenantModule } from './core/tenant';

import { AuthModule } from './modules/auth/auth.module';
import { BookingModule } from './modules/booking/booking.module';
import { CareModule } from './modules/care/care.module';
import { GymModule } from './modules/gym/gym.module';
import { HealthyFoodModule } from './modules/healthy_food/healthy_food.module';
import { LoyaltyModule } from './modules/loyalty/loyalty.module';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';
import { SettingsModule } from './modules/settings/settings.module';
import { ShopModule } from './modules/shop/shop.module';

@Module({
  imports: [
    EventEmitterModule.forRoot(),

    ThrottlerModule.forRoot([
      {
        ttl: Number(process.env.THROTTLE_TTL_MS || 60_000),
        limit: Number(process.env.THROTTLE_LIMIT || 300),
      },
    ]),

    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      load: [postgresqlFactory, jwtFactory, licenseFactory],
      validationSchema: configSchema,
    }),

    // PostgreSQL
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        ...configService.get('postgresql'),
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),

    // Licences + feature flags (HMAC-SHA256, hardware ID)
    LicenseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const license = configService.get<{
          secret: string;
          devMode: boolean;
        }>('license');

        return {
          secret: license.secret,
          devMode: license.devMode,
        };
      },
    }),

    // Socle sécurité global (JWT, PermissionsGuard)
    SecurityModule,

    // Idempotence transactionnelle PostgreSQL
    IdempotencyModule,

    // Outbox transactionnelle + worker durable
    OutboxModule,

    // Observabilité : logs structurés, métriques, corrélation
    ObservabilityModule,

    // Rétention idempotency/outbox
    RetentionModule,

    // Contexte tenant, memberships et isolation SaaS
    TenantModule,

    // Métiers
    AuthModule,
    GymModule,
    CareModule,
    BookingModule,
    MaintenanceModule,
    SettingsModule,
    ShopModule,
    LoyaltyModule,
    HealthyFoodModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
