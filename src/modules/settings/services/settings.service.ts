import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { UpdateSettingsDto } from '../dto/settings.dto';
import {
  CancellationPolicy,
  DEFAULT_CANCELLATION_POLICY,
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_SECONDARY_COLOR,
  DEFAULT_TAX_RATES,
  SETTINGS_ID,
  Settings,
  TaxRate,
} from '../entities/settings.entity';

/** Sous-ensemble public utilisé pour le branding de l'application. */
export interface BrandingSettings {
  gymName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  currency: string;
  locale: string;
}

const DEFAULT_GYM_NAME = 'GymSoinsHealthy';

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(Settings)
    private readonly settingsRepository: Repository<Settings>,
  ) {}

  /**
   * Récupère la configuration singleton, en la créant avec des valeurs par
   * défaut si elle n'existe pas encore (installation neuve).
   */
  async getSettings(): Promise<Settings> {
    const existing = await this.settingsRepository.findOne({
      where: { id: SETTINGS_ID },
    });

    if (existing) {
      return existing;
    }

    const settings = this.settingsRepository.create({
      id: SETTINGS_ID,
      gymName: DEFAULT_GYM_NAME,
      logoUrl: null,
      primaryColor: DEFAULT_PRIMARY_COLOR,
      secondaryColor: DEFAULT_SECONDARY_COLOR,
      currency: 'EUR',
      locale: 'fr',
      taxRates: DEFAULT_TAX_RATES,
      cancellationPolicy: DEFAULT_CANCELLATION_POLICY,
    });

    return this.settingsRepository.save(settings);
  }

  /** Branding accessible sans authentification (écran de connexion, thème). */
  async getBranding(): Promise<BrandingSettings> {
    const settings = await this.getSettings();

    return {
      gymName: settings.gymName,
      logoUrl: settings.logoUrl,
      primaryColor: settings.primaryColor,
      secondaryColor: settings.secondaryColor,
      currency: settings.currency,
      locale: settings.locale,
    };
  }

  async updateSettings(dto: UpdateSettingsDto): Promise<Settings> {
    const settings = await this.getSettings();

    if (dto.gymName !== undefined) {
      settings.gymName = dto.gymName.trim();
    }

    if (dto.logoUrl !== undefined) {
      const logoUrl = dto.logoUrl.trim();
      settings.logoUrl = logoUrl || null;
    }

    if (dto.primaryColor !== undefined) {
      settings.primaryColor = dto.primaryColor.toLowerCase();
    }

    if (dto.secondaryColor !== undefined) {
      settings.secondaryColor = dto.secondaryColor.toLowerCase();
    }

    if (dto.currency !== undefined) {
      settings.currency = dto.currency.toUpperCase();
    }

    if (dto.locale !== undefined) {
      settings.locale = this.normalizeLocale(dto.locale);
    }

    if (dto.taxRates !== undefined) {
      settings.taxRates = this.normalizeTaxRates(dto.taxRates);
    }

    if (dto.cancellationPolicy !== undefined) {
      settings.cancellationPolicy = this.mergeCancellationPolicy(
        settings.cancellationPolicy,
        dto.cancellationPolicy,
      );
    }

    return this.settingsRepository.save(settings);
  }

  /** Normalise les taux : identifiants uniques, libellés non dupliqués. */
  private normalizeTaxRates(
    rates: Array<{ id?: string; label: string; rate: number }>,
  ): TaxRate[] {
    const seenLabels = new Set<string>();
    const seenIds = new Set<string>();

    return rates.map((rate) => {
      const label = rate.label.trim();
      const key = label.toLowerCase();

      if (seenLabels.has(key)) {
        throw new BadRequestException(
          `Le taux de TVA « ${label} » est présent plusieurs fois`,
        );
      }
      seenLabels.add(key);

      let id = rate.id?.trim() || randomUUID();
      if (seenIds.has(id)) {
        id = randomUUID();
      }
      seenIds.add(id);

      return {
        id,
        label,
        rate: this.round(rate.rate),
      };
    });
  }

  private mergeCancellationPolicy(
    current: CancellationPolicy | undefined,
    update: Partial<CancellationPolicy>,
  ): CancellationPolicy {
    const base = { ...DEFAULT_CANCELLATION_POLICY, ...(current ?? {}) };

    return {
      freeCancellationHours:
        update.freeCancellationHours ?? base.freeCancellationHours,
      lateCancellationFeePercent:
        update.lateCancellationFeePercent ?? base.lateCancellationFeePercent,
      noShowFeePercent: update.noShowFeePercent ?? base.noShowFeePercent,
      notes:
        update.notes !== undefined
          ? update.notes.trim()
          : base.notes ?? '',
    };
  }

  private normalizeLocale(locale: string): string {
    const [language, region] = locale.trim().split('-');
    return region
      ? `${language.toLowerCase()}-${region.toUpperCase()}`
      : language.toLowerCase();
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
