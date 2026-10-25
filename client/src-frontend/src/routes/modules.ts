import {
  Calendar,
  Dumbbell,
  HeartPulse,
  Leaf,
  ShoppingCart,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

import type { LicensedFeature } from '@/types';

/**
 * Source unique de vérité pour la navigation et le routage.
 *
 * Le `path` est l'URL réellement déclarée dans le routeur ; il ne doit jamais
 * être déduit de l'`id` (qui correspond au feature flag de licence, ex.
 * `healthy_food` → `/healthy-food`).
 */
export interface AppModule {
  id: string;
  path: string;
  label: string;
  feature: LicensedFeature;
  icon: LucideIcon;
}

export const APP_MODULES: AppModule[] = [
  {
    id: 'gym',
    path: '/gym',
    label: 'Salle de sport',
    feature: 'gym',
    icon: Dumbbell,
  },
  {
    id: 'care',
    path: '/care',
    label: 'Soins & thérapies',
    feature: 'care',
    icon: HeartPulse,
  },
  {
    id: 'booking',
    path: '/booking',
    label: 'Réservations',
    feature: 'booking',
    icon: Calendar,
  },
  {
    id: 'maintenance',
    path: '/maintenance',
    label: 'Maintenance',
    feature: 'maintenance',
    icon: Wrench,
  },
  {
    id: 'shop',
    path: '/shop',
    label: 'Boutique',
    feature: 'shop',
    icon: ShoppingCart,
  },
  {
    id: 'loyalty',
    path: '/loyalty',
    label: 'Fidélité',
    feature: 'loyalty',
    icon: Users,
  },
  {
    id: 'healthy_food',
    path: '/healthy-food',
    label: 'Cuisine Healthy',
    feature: 'healthy_food',
    icon: Leaf,
  },
];

/** Page d'administration de la configuration (hors modules sous licence). */
export const SETTINGS_PATH = '/settings';
export const SETTINGS_LABEL = 'Configuration';

/** Retrouve la définition d'un module à partir de son URL. */
export function findModuleByPath(pathname: string): AppModule | undefined {
  return APP_MODULES.find((module) => module.path === pathname);
}
