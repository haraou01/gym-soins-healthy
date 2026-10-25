/**
 * Rôles autorisés à administrer la configuration globale.
 *
 * Le RBAC backend ne définit que `SUPER_ADMIN` comme rôle d'administration ;
 * `ADMIN` est accepté pour rester compatible avec les futurs rôles.
 */
export const SETTINGS_ROLES = ['SUPER_ADMIN', 'ADMIN'] as const;

export function canManageSettings(role?: string | null): boolean {
  return role
    ? (SETTINGS_ROLES as readonly string[]).includes(role)
    : false;
}
