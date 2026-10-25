import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

export type Density = 'comfortable' | 'compact';

/** Clé lue par le script anti-FOUC de `index.html`. */
export const DENSITY_STORAGE_KEY = 'gymsoins_density';

interface DensityContextValue {
  density: Density;
  setDensity: (density: Density) => void;
  toggleDensity: () => void;
}

const DensityContext = createContext<DensityContextValue | null>(null);

function readStoredDensity(): Density {
  try {
    return localStorage.getItem(DENSITY_STORAGE_KEY) === 'compact'
      ? 'compact'
      : 'comfortable';
  } catch {
    return 'comfortable';
  }
}

export function DensityProvider({ children }: { children: React.ReactNode }) {
  const [density, setDensityState] = useState<Density>(readStoredDensity);

  useEffect(() => {
    document.documentElement.dataset.density = density;

    try {
      localStorage.setItem(DENSITY_STORAGE_KEY, density);
    } catch {
      // Stockage indisponible : la densité reste appliquée pour la session.
    }
  }, [density]);

  const setDensity = useCallback((next: Density) => {
    setDensityState(next);
  }, []);

  const toggleDensity = useCallback(() => {
    setDensityState((current) =>
      current === 'compact' ? 'comfortable' : 'compact',
    );
  }, []);

  const value = useMemo<DensityContextValue>(
    () => ({ density, setDensity, toggleDensity }),
    [density, setDensity, toggleDensity],
  );

  return (
    <DensityContext.Provider value={value}>
      {children}
    </DensityContext.Provider>
  );
}

export function useDensity(): DensityContextValue {
  const context = useContext(DensityContext);
  if (!context) {
    throw new Error(
      'useDensity doit être utilisé à l’intérieur de DensityProvider',
    );
  }
  return context;
}
