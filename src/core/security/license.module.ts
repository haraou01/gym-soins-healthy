import { DynamicModule, Module } from '@nestjs/common';

import { LicenseController } from './license.controller';
import { LicenseConfig, LicenseService } from './license.service';

/** Token du provider de configuration de licence. */
export const LICENSE_CONFIG = 'LICENSE_CONFIG';

@Module({})
export class LicenseModule {
  /**
   * Configuration statique du module de licence.
   *
   * ```ts
   * LicenseModule.forRoot({ secret: 'ma-cle-secrete' })
   * ```
   */
  static forRoot(config: LicenseConfig): DynamicModule {
    return {
      module: LicenseModule,
      controllers: [LicenseController],
      providers: [
        {
          provide: LicenseService,
          useValue: new LicenseService(config),
        },
      ],
      exports: [LicenseService],
    };
  }

  /**
   * Configuration asynchrone (recommandée pour lire le secret depuis ConfigService).
   */
  static forRootAsync(options: {
    inject: Array<any>;
    useFactory: (...args: any[]) => LicenseConfig;
  }): DynamicModule {
    return {
      module: LicenseModule,
      controllers: [LicenseController],
      providers: [
        {
          provide: LICENSE_CONFIG,
          useFactory: options.useFactory,
          inject: options.inject,
        },
        {
          provide: LicenseService,
          useFactory: (config: LicenseConfig) => new LicenseService(config),
          inject: [LICENSE_CONFIG],
        },
      ],
      exports: [LicenseService],
    };
  }
}
