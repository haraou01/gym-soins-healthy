import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { hasPermission } from '../../modules/auth/permissions';

export const PERMISSION_KEY = 'permission';

/**
 * Garde de route RBAC.
 *
 * Utilisation :
 *   @UseGuards(PermissionsGuard)
 *   @SetMetadata('permission', { resource: 'gym', action: 'create' })
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.get<{ resource: string; action: 'create' | 'read' | 'update' | 'delete' }>(
      PERMISSION_KEY,
      context.getHandler(),
    );

    if (!required) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as { role?: string } | undefined;

    if (!user || !user.role) {
      throw new ForbiddenException('Utilisateur non authentifié.');
    }

    const allowed = hasPermission(user.role, required.resource, required.action);

    if (!allowed) {
      throw new ForbiddenException(
        `Accès refusé : ${required.resource}:${required.action} non autorisé pour le rôle ${user.role}`,
      );
    }

    return true;
  }
}
