import { Rows3, Rows4 } from 'lucide-react';

import { useDensity } from '@/hooks/useDensity';
import { cn } from '@/lib/utils';

/**
 * Bascule la densité des interfaces métier (tableaux, POS, KDS, planning).
 * Le mode compact réduit les espacements sans descendre sous les seuils
 * tactiles (voir les règles `pointer: coarse` dans index.css).
 */
export function DensityToggle({ className }: { className?: string }) {
  const { density, toggleDensity } = useDensity();
  const compact = density === 'compact';
  const Icon = compact ? Rows4 : Rows3;

  return (
    <button
      type="button"
      onClick={toggleDensity}
      aria-pressed={compact}
      aria-label={
        compact
          ? 'Activer l’affichage confortable'
          : 'Activer l’affichage compact'
      }
      title={
        compact
          ? 'Affichage compact — cliquer pour revenir au mode confortable'
          : 'Affichage confortable — cliquer pour passer au mode compact'
      }
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface-raised text-content-muted transition-colors duration-150 hover:bg-surface-overlay hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
        compact && 'border-brand-500/40 bg-brand-500/10 text-brand-700 dark:text-brand-500',
        className,
      )}
    >
      <Icon size={17} />
    </button>
  );
}
