import {
  Body,
  Controller,
  Get,
  Put,
  UseGuards,
} from '@nestjs/common';

import { Public } from '../../../core/security/public.decorator';
import { Roles } from '../../../core/security/roles.decorator';
import { RolesGuard } from '../../../core/security/roles.guard';
import { UpdateSettingsDto } from '../dto/settings.dto';
import {
  BrandingSettings,
  SettingsService,
} from '../services/settings.service';
import { Settings } from '../entities/settings.entity';

/** Rôles autorisés à lire/écrire la configuration complète. */
const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN'];

@Controller('api/v1/settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  /**
   * Branding public : nécessaire au thème et à l'écran de connexion avant
   * authentification. Aucune donnée sensible n'y figure.
   */
  @Public()
  @Get('branding')
  getBranding(): Promise<BrandingSettings> {
    return this.settingsService.getBranding();
  }

  /** Configuration complète (TVA, annulation) : administrateurs uniquement. */
  @Get()
  @UseGuards(RolesGuard)
  @Roles(...ADMIN_ROLES)
  getSettings(): Promise<Settings> {
    return this.settingsService.getSettings();
  }

  @Put()
  @UseGuards(RolesGuard)
  @Roles(...ADMIN_ROLES)
  updateSettings(@Body() dto: UpdateSettingsDto): Promise<Settings> {
    return this.settingsService.updateSettings(dto);
  }
}
