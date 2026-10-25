import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';

import { useTheme, type ThemePreference } from '@/hooks/useTheme';
import { cn } from '@/lib/utils';

const OPTIONS: Array<{
  value: ThemePreference;
  label: string;
  icon: LucideIcon;
}> = [
  { value: 'light', label: 'Clair', icon: Sun },
  { value: 'dark', label: 'Sombre', icon: Moon },
  { value: 'system', label: 'Système', icon: Monitor },
];

/**
 * Sélecteur d'apparence accessible (clair / sombre / système).
 * Le choix est persisté par `ThemeProvider` et appliqué sans rechargement.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  return (
    <div
      role="group"
      aria-label="Thème de l’interface"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-lg border border-line bg-surface-raised p-0.5',
        className,
      )}
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = theme === value;

        return (
          <button
            key={value}
            type="button"
            onClick={() => setTheme(value)}
            aria-pressed={active}
            aria-label={`Thème ${label.toLowerCase()}`}
            title={`Thème ${label.toLowerCase()}`}
            className={cn(
              'inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
              active
                ? 'bg-card text-brand-700 dark:text-brand-500 shadow-sm'
                : 'text-content-subtle hover:bg-surface-overlay hover:text-content',
            )}
          >
            <Icon size={16} />
          </button>
        );
      })}
    </div>
  );
}
