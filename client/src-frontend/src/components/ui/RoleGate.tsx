import { ShieldAlert } from 'lucide-react';

import { Card } from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';

/** Affiche son contenu uniquement aux rôles autorisés. */
export function RoleGate({
  roles,
  children,
}: {
  roles: readonly string[];
  children: React.ReactNode;
}) {
  const { user, isLoading } = useAuth();

  if (isLoading) return null;

  if (!user || !roles.includes(user.role)) {
    return (
      <Card className="mx-auto max-w-lg text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-red-500/30 bg-red-500/10 text-red-800 dark:text-red-400">
          <ShieldAlert size={24} />
        </div>
        <h2 className="text-lg font-semibold text-content">
          Accès restreint
        </h2>
        <p className="mt-2 text-sm text-content-muted">
          Cette page est réservée aux administrateurs de l’établissement.
        </p>
      </Card>
    );
  }

  return <>{children}</>;
}
