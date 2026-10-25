/**
 * Types du système de licence.
 *
 * Une licence est un jeton signé (HMAC-SHA256) contenant :
 *  - l'identifiant de licence et le client ;
 *  - l'empreinte matérielle (Hardware ID) de la machine autorisée ;
 *  - le périmètre (scope) : liste de modules activés, ou "all" (all-in-one) ;
 *  - les dates d'émission et d'expiration.
 */

export const LICENSED_FEATURES = [
  'gym',
  'care',
  'maintenance',
  'booking',
  'shop',
  'loyalty',
  'healthy_food',
] as const;

export type LicensedFeature = (typeof LICENSED_FEATURES)[number];

export const LICENSE_SCOPE_ALL = 'all';

export type LicenseScope = LicensedFeature | typeof LICENSE_SCOPE_ALL;

/** Version du format de clé. Permet d'invalider proprement les anciens formats. */
export const LICENSE_KEY_VERSION = 'v1';

export interface LicensePayload {
  /** Identifiant unique de la licence (ex: GSH-2026-0001). */
  licenseId: string;
  /** Nom du client (optionnel, purement informatif). */
  customer?: string;
  /** Empreinte matérielle autorisée. */
  hardwareId: string;
  /** Modules autorisés ou "all" pour le pack complet. */
  scope: LicenseScope[];
  /** Date d'émission (ISO 8601). */
  issuedAt: string;
  /** Date d'expiration (ISO 8601). */
  expiresAt: string;
}

export interface ResolvedLicense {
  licenseId: string;
  customer?: string;
  hardwareId: string;
  /** Modules réellement activés (scope "all" déjà résolu). */
  modules: LicensedFeature[];
  issuedAt: string;
  expiresAt: string;
}

/** Discrimine une valeur JSON inconnue en `LicensePayload`. */
export function isLicensePayload(value: unknown): value is LicensePayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.licenseId === 'string' &&
    candidate.licenseId.trim().length > 0 &&
    typeof candidate.hardwareId === 'string' &&
    candidate.hardwareId.trim().length > 0 &&
    typeof candidate.issuedAt === 'string' &&
    typeof candidate.expiresAt === 'string' &&
    Array.isArray(candidate.scope) &&
    candidate.scope.length > 0 &&
    candidate.scope.every(isLicenseScope)
  );
}

export function isLicenseScope(value: unknown): value is LicenseScope {
  return value === LICENSE_SCOPE_ALL || LICENSED_FEATURES.includes(value as LicensedFeature);
}

export function isLicensedFeature(value: unknown): value is LicensedFeature {
  return LICENSED_FEATURES.includes(value as LicensedFeature);
}
