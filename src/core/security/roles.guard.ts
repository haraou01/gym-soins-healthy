import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ROLES_KEY } from './roles.decorator';

/**
 * Garde RBAC par rôle.
 *
 * À placer après l'authentification (le `JwtAuthGuard` global est exécuté en
 * premier). Sans métadonnées `@Roles(...)`, la route n'est pas restreinte.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as { role?: string } | undefined;

    if (!user?.role) {
      throw new ForbiddenException('Utilisateur non authentifié.');
    }

    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException(
        `Accès refusé : rôle ${user.role} non autorisé sur cette ressource.`,
      );
    }

    return true;
  }
}
