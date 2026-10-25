import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { useSettings } from '@/hooks/useSettings';
import {
  THEME_SURFACE_COLORS,
  applyThemeColors,
  type ThemeMode,
} from '@/lib/theme';

export type ThemePreference = 'light' | 'dark' | 'system';

/** Clé lue par le script anti-FOUC de `index.html`. */
export const THEME_STORAGE_KEY = 'gymsoins_theme';

interface ThemeContextValue {
  /** Préférence utilisateur : clair, sombre ou système. */
  theme: ThemePreference;
  /** Thème réellement appliqué après résolution de `system`. */
  resolvedTheme: ThemeMode;
  setTheme: (theme: ThemePreference) => void;
  /** Bascule entre clair et sombre (choix explicite). */
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
  } catch {
    // Stockage indisponible : on retombe sur la préférence système.
  }
  return 'system';
}

function getSystemTheme(): ThemeMode {
  if (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function'
  ) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }
  return 'dark';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();
  const [theme, setThemeState] = useState<ThemePreference>(
    readStoredPreference,
  );
  const [systemTheme, setSystemTheme] = useState<ThemeMode>(getSystemTheme);

  // Suit les changements de préférence système en direct.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemTheme(event.matches ? 'dark' : 'light');
    };

    setSystemTheme(media.matches ? 'dark' : 'light');
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, []);

  const resolvedTheme: ThemeMode =
    theme === 'system' ? systemTheme : theme;

  useEffect(() => {
    const root = document.documentElement;

    root.classList.toggle('dark', resolvedTheme === 'dark');
    root.dataset.theme = resolvedTheme;
    root.style.colorScheme = resolvedTheme;

    // Recalcule les nuances whitelabel pour le mode courant (contrastes AA).
    applyThemeColors(
      settings.primaryColor,
      settings.secondaryColor,
      resolvedTheme,
    );

    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) {
      themeColor.setAttribute('content', THEME_SURFACE_COLORS[resolvedTheme]);
    }

    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Stockage indisponible : le thème reste appliqué pour la session.
    }
  }, [resolvedTheme, theme, settings.primaryColor, settings.secondaryColor]);

  const setTheme = useCallback((next: ThemePreference) => {
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState(resolvedTheme === 'dark' ? 'light' : 'dark');
  }, [resolvedTheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme, toggleTheme }),
    [theme, resolvedTheme, setTheme, toggleTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error(
      'useTheme doit être utilisé à l’intérieur de ThemeProvider',
    );
  }
  return context;
}
