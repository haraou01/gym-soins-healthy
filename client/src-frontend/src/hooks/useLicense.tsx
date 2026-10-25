import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { LicensedFeature } from '@/types';
import { licenseAPI } from '@/api';

const ALL_LICENSED_FEATURES: LicensedFeature[] = [
  'gym',
  'care',
  'maintenance',
  'booking',
  'shop',
  'loyalty',
  'healthy_food',
];

/**
 * En développement, tous les modules sont débloqués par défaut afin qu'une
 * licence locale absente, partielle ou obsolète ne masque jamais un menu.
 * `VITE_LICENSE_ENFORCE=true` (avec `LICENSE_DEV_MODE=false` côté API) rétablit
 * le filtrage pour tester les écrans verrouillés en local.
 */
const DEV_UNLOCK_ALL_MODULES =
  import.meta.env.DEV &&
  !['1', 'true', 'yes', 'on'].includes(
    (import.meta.env.VITE_LICENSE_ENFORCE ?? '').trim().toLowerCase(),
  );

export const LICENSE_KEY_STORAGE = 'gymsoins_license_key';
export const HARDWARE_ID_STORAGE = 'gymsoins_hardware_id';

interface LicenseContextValue {
  license: { modules: LicensedFeature[] } | null;
  isLoading: boolean;
  hasFeature: (feature: LicensedFeature) => boolean;
  hasAnyFeature: (features: LicensedFeature[]) => boolean;
  hasAllFeatures: (features: LicensedFeature[]) => boolean;
  refresh: () => Promise<void>;
}

const LicenseContext = createContext<LicenseContextValue | null>(null);

function readStoredValue(storageKey: string): string | undefined {
  try {
    return localStorage.getItem(storageKey) || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Licence active : priorité au localStorage (licence activée par l'utilisateur),
 * puis aux variables d'environnement Vite (build/installation).
 */
function readLicenseCredentials(): { licenseKey?: string; hardwareId?: string } {
  return {
    licenseKey: readStoredValue(LICENSE_KEY_STORAGE) ?? import.meta.env.VITE_LICENSE_KEY,
    hardwareId: readStoredValue(HARDWARE_ID_STORAGE) ?? import.meta.env.VITE_HARDWARE_ID,
  };
}

export function LicenseProvider({ children }: { children: React.ReactNode }) {
  const [license, setLicense] = useState<{ modules: LicensedFeature[] } | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (DEV_UNLOCK_ALL_MODULES) {
      setLicense({ modules: [...ALL_LICENSED_FEATURES] });
      setIsLoading(false);
      return;
    }

    const { licenseKey, hardwareId } = readLicenseCredentials();

    try {
      const response = await licenseAPI.getFeatures(licenseKey, hardwareId);
      setLicense({ modules: (response.data.modules ?? []) as LicensedFeature[] });
    } catch {
      // Licence configurée mais invalide / expirée / matériel différent :
      // tout est verrouillé hors mode développement.
      setLicense({ modules: [] });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const hasFeature = useCallback(
    (feature: LicensedFeature) => license?.modules.includes(feature) ?? false,
    [license]
  );

  const hasAnyFeature = useCallback(
    (features: LicensedFeature[]) =>
      features.some((f) => license?.modules.includes(f) ?? false),
    [license]
  );

  const hasAllFeatures = useCallback(
    (features: LicensedFeature[]) =>
      features.every((f) => license?.modules.includes(f) ?? false),
    [license]
  );

  const value: LicenseContextValue = {
    license,
    isLoading,
    hasFeature,
    hasAnyFeature,
    hasAllFeatures,
    refresh,
  };

  return <LicenseContext.Provider value={value}>{children}</LicenseContext.Provider>;
}

export function useLicense() {
  const context = useContext(LicenseContext);
  if (!context) {
    throw new Error('useLicense doit être utilisé à l’intérieur de LicenseProvider');
  }
  return context;
}
