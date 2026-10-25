import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * Restreint une route (ou un contrôleur) aux rôles listés.
 *
 * S'utilise avec `RolesGuard` après le `JwtAuthGuard` global, qui alimente
 * `request.user`.
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
