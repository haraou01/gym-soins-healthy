/**
 * Contrôle d'accès granulaire (RBAC) pour le module Auth.
 *
 * Rôles stricts supportés :
 *  - SUPER_ADMIN   : plein pouvoir sur tous les modules
 *  - RECEPTIONIST  : gestion des membres, réservations, vente boutique
 *  - COACH         : suivi des membres, thérapies et plannings
 *  - THERAPIST     : soins et thérapies (lecture/écriture des dossiers)
 *  - CHEF          : cuisine, plats, KDS et décrémentation des stocks (healthy_food)
 */

export const LICENSED_FEATURES = [
  'gym',
  'care',
  'shop',
  'healthy_food',
  'maintenance',
  'booking',
  'loyalty',
] as const;

export type LicensedFeature = (typeof LICENSED_FEATURES)[number];

export type Role = 'SUPER_ADMIN' | 'RECEPTIONIST' | 'COACH' | 'THERAPIST' | 'CHEF';

export interface Permission {
  /** Module concerné : gym, care, booking, maintenance, shop, loyalty, healthy_food, users */
  resource: string;
  /** Actions autorisées sur cette ressource. '*' = toutes les actions. */
  actions: Array<'create' | 'read' | 'update' | 'delete' | '*'>;
}

export interface RolePermissions {
  role: Role;
  permissions: Permission[];
}

const ALL_ACTIONS: Permission['actions'] = ['create', 'read', 'update', 'delete'];

/** Mapping rôle → permissions granulaires. */
export const RBAC_PERMISSIONS: Record<Role, Permission[]> = {
  SUPER_ADMIN: LICENSED_FEATURES.map((resource) => ({
    resource,
    actions: ['*'],
  })),

  RECEPTIONIST: [
    { resource: 'gym', actions: ['read', 'create', 'update'] },
    { resource: 'booking', actions: ['create', 'read', 'update'] },
    { resource: 'shop', actions: ['create', 'read', 'update'] },
    { resource: 'care', actions: ['read'] },
    { resource: 'loyalty', actions: ['read', 'update'] },
  ],

  COACH: [
    { resource: 'gym', actions: ['read'] },
    { resource: 'care', actions: ['read', 'update'] },
    { resource: 'booking', actions: ['read', 'update'] },
    { resource: 'loyalty', actions: ['read'] },
  ],

  THERAPIST: [
    { resource: 'care', actions: ['create', 'read', 'update', 'delete'] },
    { resource: 'booking', actions: ['read'] },
    { resource: 'healthy_food', actions: ['read'] },
  ],

  CHEF: [
    { resource: 'healthy_food', actions: ['create', 'read', 'update', 'delete'] },
    { resource: 'shop', actions: ['read'] },
  ],
};

/** Retourne les permissions d'un rôle donné. Lève si le rôle est inconnu. */
export function getPermissionsForRole(role: string): Permission[] {
  const normalized = role as Role;
  const permissions = RBAC_PERMISSIONS[normalized];

  if (!permissions) {
    throw new Error(`Rôle RBAC inconnu : ${role}`);
  }

  return permissions;
}

/** Vérifie si un rôle détient une permission sur une ressource/action donnée. */
export function hasPermission(
  role: string,
  resource: string,
  action: 'create' | 'read' | 'update' | 'delete',
): boolean {
  const permissions = getPermissionsForRole(role);

  return permissions.some(
    (p) =>
      p.resource === resource &&
      (p.actions.includes('*') || p.actions.includes(action)),
  );
}

/** Retourne la liste des modules (feature flags) accessibles pour un rôle. */
export function getAccessibleModules(role: string): LicensedFeature[] {
  const permissions = getPermissionsForRole(role);

  return permissions
    .map((p) => p.resource)
    .filter((r): r is LicensedFeature => LICENSED_FEATURES.includes(r as LicensedFeature));
}
