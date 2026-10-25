import {
  Controller,
  Get,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { LicenseError, LicenseService } from './license.service';
import { Public } from './public.decorator';

/**
 * Expose les feature flags de la licence active.
 *
 * La clé et l'empreinte matérielle peuvent être fournies par en-têtes
 * (`x-license-key`, `x-hardware-id`) ou, à défaut, par l'environnement
 * (`LICENSE_KEY`, `LICENSE_HARDWARE_ID`) pour une installation Plug-and-Play.
 *
 * En mode développement (`LICENSE_DEV_MODE`, actif par défaut hors production),
 * l'intégralité des modules est renvoyée sans validation, même si une clé ou une
 * empreinte est fournie. En production, la clé et l'empreinte sont obligatoires
 * et strictement validées (signature, matériel, expiration).
 */
@Public()
@Controller('api/v1/license')
export class LicenseController {
  constructor(
    private readonly licenseService: LicenseService,
    private readonly configService: ConfigService,
  ) {}

  @Get('features')
  async getFeatures(
    @Headers('x-license-key') licenseKeyHeader?: string,
    @Headers('x-hardware-id') hardwareIdHeader?: string,
  ): Promise<{ modules: string[] }> {
    const licenseKey =
      licenseKeyHeader || this.configService.get<string>('LICENSE_KEY');
    const hardwareId =
      hardwareIdHeader || this.configService.get<string>('LICENSE_HARDWARE_ID');

    try {
      const modules = await this.licenseService.resolveFeatureFlags(
        hardwareId,
        licenseKey,
      );

      return { modules };
    } catch (error) {
      if (error instanceof LicenseError) {
        throw new UnauthorizedException(error.message);
      }

      throw error;
    }
  }
}
