import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { settingsAPI } from '@/api';
import {
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_SECONDARY_COLOR,
} from '@/lib/theme';
import { setActiveCurrency } from '@/lib/utils';
import type {
  AppSettings,
  BrandingSettings,
  UpdateSettingsInput,
} from '@/types';

/**
 * Branding par défaut, identique aux variables CSS de `index.css`.
 * Il est affiché pendant le chargement puis remplacé par la configuration
 * enregistrée en base.
 */
export const DEFAULT_BRANDING: BrandingSettings = {
  gymName: 'GymSoinsHealthy',
  logoUrl: null,
  primaryColor: DEFAULT_PRIMARY_COLOR,
  secondaryColor: DEFAULT_SECONDARY_COLOR,
  currency: 'EUR',
  locale: 'fr',
};

/**
 * Applique le branding au document (titre, langue, devise).
 * Les couleurs sont appliquées par `ThemeProvider`, qui connaît le mode
 * clair/sombre courant et recalcule les nuances accessibles.
 */
export function applyBranding(settings: BrandingSettings): void {
  setActiveCurrency(settings.currency);
  document.title = settings.gymName;
  document.documentElement.lang = settings.locale;
}

interface SettingsContextValue {
  /** Branding courant (nom, logo, couleurs, devise, locale). */
  settings: BrandingSettings;
  isLoading: boolean;
  /** Recharge le branding depuis l'API (endpoint public). */
  refresh: () => Promise<void>;
  /** Enregistre la configuration (administrateurs) puis l'applique. */
  save: (input: UpdateSettingsInput) => Promise<AppSettings>;
  /** Applique un branding déjà chargé (ex. réponse d'un PUT). */
  apply: (settings: BrandingSettings) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<BrandingSettings>(DEFAULT_BRANDING);
  const [isLoading, setIsLoading] = useState(true);

  const apply = useCallback((next: BrandingSettings) => {
    setSettings(next);
    applyBranding(next);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const { data } = await settingsAPI.getBranding();
      apply(data);
    } catch {
      // Le branding est cosmétique : en cas d'échec (backend indisponible),
      // on conserve les valeurs par défaut sans bloquer l'application.
      applyBranding(DEFAULT_BRANDING);
    } finally {
      setIsLoading(false);
    }
  }, [apply]);

  useEffect(() => {
    applyBranding(DEFAULT_BRANDING);
    void refresh();
  }, [refresh]);

  const save = useCallback(
    async (input: UpdateSettingsInput) => {
      const { data } = await settingsAPI.update(input);
      apply(data);
      return data;
    },
    [apply],
  );

  const value = useMemo<SettingsContextValue>(
    () => ({ settings, isLoading, refresh, save, apply }),
    [settings, isLoading, refresh, save, apply],
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error(
      'useSettings doit être utilisé à l’intérieur de SettingsProvider',
    );
  }
  return context;
}
