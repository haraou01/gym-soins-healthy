// core/security/permissions.guard.ts
import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Inject } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermission = this.reflector.get<{ module: string; action: string }>(
      'permission',
      context.getHandler(),
    );

    if (!requiredPermission) {
      return true; // Si aucune permission spécifique n'est requise sur la route
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user; // Injecté par le middleware JWT Auth

    if (!user || !user.id) {
      throw new ForbiddenException('Utilisateur non authentifié.');
    }

    // Clé de cache Redis pour les permissions de l'utilisateur
    const cacheKey = `user_permissions:${user.id}`;
    let userPermissions: string[] = await this.cacheManager.get(cacheKey);

    if (!userPermissions) {
      // Si absent du cache Redis, on simule/exécute la requête DB optimisée
      // (jointure users -> roles -> role_permissions -> permissions)
      userPermissions = await this.fetchUserPermissionsFromDB(user.id);
      
      // Mise en cache pour 10 minutes (TTL = 600s) pour optimiser les performances
      await this.cacheManager.set(cacheKey, userPermissions, 600000);
    }

    const permissionString = `${requiredPermission.module}:${requiredPermission.action}`;
    const hasAccess = userPermissions.includes(permissionString);

    if (!hasAccess) {
      throw new ForbiddenException(`Accès refusé. Module ou action non autorisé : ${permissionString}`);
    }

    return true;
  }

  private async fetchUserPermissionsFromDB(userId: string): Promise<string[]> {
    // Implémentation de la requête SQL optimisée avec jointure indexée
    // Retourne un tableau de chaînes ex: ['gym:read', 'gym:create', 'care:read']
    return []; 
  }
}