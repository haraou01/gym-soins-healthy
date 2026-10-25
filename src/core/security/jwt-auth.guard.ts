import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * Garde JWT globale.
 *
 * Toutes les routes sont protégées par défaut : le porteur du jeton doit être
 * authentifié. Les endpoints explicitement marqués `@Public()` (login, licence)
 * restent accessibles sans jeton.
 *
 * La stratégie `jwt` (AuthModule) valide la signature et l'expiration puis
 * expose `request.user = { id, email, role }`, exploité ensuite par
 * `PermissionsGuard`.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }
}
