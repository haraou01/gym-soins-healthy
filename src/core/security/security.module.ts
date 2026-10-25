import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { LicenseModule } from './license.module';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PermissionsGuard } from './permissions.guard';
import { RolesGuard } from './roles.guard';

/**
 * Socle de sécurité global (transverse).
 *
 * Fournit :
 *  - JwtModule (authentification stateless)
 *  - PermissionsGuard (garde RBAC à appliquer par route)
 *
 * `@Global` permet d'injecter JwtService / PermissionsGuard depuis n'importe
 * quel module sans import explicite.
 *
 * La validation de licence (`LicenseModule`, feature flags + contrôle matériel)
 * est enregistrée à la racine dans `AppModule`, car elle dépend de la
 * configuration applicative (secret HMAC).
 */
@Global()
@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const jwt = configService.get<{ secret: string; expiresIn: string }>('jwt');
        return {
          secret: jwt.secret,
          signOptions: { expiresIn: jwt.expiresIn || '1d' },
        };
      },
    }),
    // Le forRoot est appelé depuis AppModule (voir AppModule imports)
    // pour garder la responsabilité de la config secrète au niveau racine.
  ],
  providers: [
    // Authentification obligatoire sur toutes les routes non marquées @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    PermissionsGuard,
    RolesGuard,
  ],
  exports: [JwtModule, PermissionsGuard, RolesGuard],
})
export class SecurityModule {}
