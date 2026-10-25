import type { ReactNode } from 'react';

import { useLicense } from '@/hooks/useLicense';
import type { LicensedFeature } from '@/types';

/**
 * Affiche un composant optionnel uniquement si le module est sous licence.
 *
 * Retourne `null` par défaut : un widget Loyalty, un bouton KDS ou une action
 * Maintenance peut être monté dans l'arbre sans provoquer d'erreur si le
 * module correspondant est désactivé.
 */
export function FeatureGate({
  feature,
  children,
  fallback = null,
}: {
  feature: LicensedFeature;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { hasFeature, isLoading } = useLicense();

  if (isLoading || !hasFeature(feature)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
