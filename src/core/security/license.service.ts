import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';

import {
  LICENSED_FEATURES,
  LICENSE_SCOPE_ALL,
  type LicensePayload,
  type LicenseScope,
  isLicensePayload,
  isLicenseScope,
} from './license.types';

/**
 * Configuration nécessaire à la validation des licences.
 *
 * Les valeurs sont injectées par NestJS ConfigService et peuvent surcharger
 * les variables d'environnement dans `.env`.
 */
export interface LicenseConfig {
  /** Clé secrète utilisée pour signer / vérifier les clés de licence (HMAC-SHA256). */
  secret: string;
  /** Durée de vie par défaut d'une licence si `expiresAt` est absent (en jours). */
  defaultTtlDays?: number;
  /**
   * Mode développement : sans clé ni empreinte matérielle, l'API renvoie
   * tous les modules. Une clé fournie reste validée normalement.
   * Toujours `false` en production.
   */
  devMode?: boolean;
}

/**
 * Erreurs métier du service de licence.
 */
export class LicenseError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'LicenseError';
  }
}

@Injectable()
export class LicenseService {
  constructor(private readonly config: LicenseConfig) {}

  /**
   * Mode développement actif : permet à l'API de licence de renvoyer tous les
   * modules quand aucune clé n'est configurée (confort local).
   */
  isDevelopmentMode(): boolean {
    return this.config.devMode === true;
  }

  /** Liste complète des modules sous licence, dans l'ordre d'affichage officiel. */
  getAllModules(): string[] {
    return [...LICENSED_FEATURES];
  }

  /**
   * Résout les feature flags d'une requête de licence.
   *
   * En mode développement, tous les modules sont renvoyés sans validation,
   * même si une clé ou une empreinte matérielle est fournie : une licence
   * locale partielle ou obsolète ne doit jamais masquer un module.
   *
   * Hors développement, la clé et l'empreinte sont obligatoires et validées
   * strictement (signature, matériel, expiration).
   */
  resolveFeatureFlags(
    hardwareId?: string,
    licenseKey?: string,
  ): Promise<string[]> {
    if (this.isDevelopmentMode()) {
      return Promise.resolve(this.getAllModules());
    }

    return this.validateAndGetModules(hardwareId ?? '', licenseKey ?? '');
  }

  /**
   * Valide une clé de licence par rapport à une empreinte matérielle et
   * retourne la liste des modules autorisés (feature flags).
   *
   * @param hardwareId Empreinte matérielle de la machine cliente.
   * @param licenseKey Clé de licence fournie par le client.
   * @returns Les modules activés (feature flags), ex: ["gym", "care"] ou ["all"].
   * @throws UnauthorizedException si la clé est invalide, expirée, liée à un autre hardware, ou manquante.
   */
  validateAndGetModules(hardwareId: string, licenseKey: string): Promise<string[]> {
    if (!hardwareId || !licenseKey) {
      throw new UnauthorizedException(
        'Clé de licence ou empreinte matérielle manquante.',
        { description: 'LICENSE_MISSING' },
      );
    }

    const payload = this.decodeAndVerify(licenseKey);
    this.assertHardwareMatch(payload, hardwareId);
    this.assertNotExpired(payload);

    const modules = this.resolveModules(payload.scope);

    return Promise.resolve(modules);
  }

  /**
   * Décode la clé (base64url JSON), vérifie la signature HMAC-SHA256 et
   * retourne le payload typé.
   */
  private decodeAndVerify(licenseKey: string): LicensePayload {
    const [encodedPayload, signature] = licenseKey.split('.');

    if (!encodedPayload || !signature) {
      throw new LicenseError('Format de clé de licence invalide.', 'LICENSE_INVALID_FORMAT');
    }

    let decoded: string;
    try {
      decoded = Buffer.from(encodedPayload, 'base64url').toString('utf-8');
    } catch {
      throw new LicenseError('Impossible de décoder la clé de licence.', 'LICENSE_DECODE_ERROR');
    }

    let payload: unknown;
    try {
      payload = JSON.parse(decoded);
    } catch {
      throw new LicenseError('Payload de licence invalide (JSON malformé).', 'LICENSE_INVALID_JSON');
    }

    if (!isLicensePayload(payload)) {
      throw new LicenseError('Payload de licence incomplet ou mal formé.', 'LICENSE_INVALID_SCHEMA');
    }

    const expectedSignature = this.sign(encodedPayload);
    const providedSignature = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    if (
      providedSignature.length !== expectedBuffer.length ||
      !timingSafeEqual(providedSignature, expectedBuffer)
    ) {
      throw new LicenseError('Signature de licence invalide.', 'LICENSE_BAD_SIGNATURE');
    }

    return payload;
  }

  private assertHardwareMatch(payload: LicensePayload, hardwareId: string): void {
    if (payload.hardwareId !== hardwareId) {
      throw new LicenseError(
        `La licence est liée à un autre matériel (${payload.hardwareId}).`,
        'LICENSE_HARDWARE_MISMATCH',
      );
    }
  }

  private assertNotExpired(payload: LicensePayload): void {
    const now = Date.now();
    const expiresAt = new Date(payload.expiresAt).getTime();

    if (Number.isNaN(expiresAt) || now >= expiresAt) {
      throw new LicenseError(
        `La licence a expiré le ${payload.expiresAt}.`,
        'LICENSE_EXPIRED',
      );
    }
  }

  private resolveModules(scope: LicenseScope[]): string[] {
    if (scope.includes(LICENSE_SCOPE_ALL)) {
      return [...LICENSED_FEATURES];
    }

    const invalid = scope.find((s) => !isLicenseScope(s));
    if (invalid) {
      throw new LicenseError(`Scope de licence inconnu : ${String(invalid)}`, 'LICENSE_UNKNOWN_SCOPE');
    }

    return scope.filter(isLicenseScope);
  }

  /**
   * Calcule la signature HMAC-SHA256 du segment de payload.
   */
  private sign(data: string): string {
    return createHmac('sha256', this.config.secret).update(data).digest('hex');
  }
}
