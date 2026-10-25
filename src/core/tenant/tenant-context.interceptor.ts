import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';

import { runWithTenantContext } from './tenant-context';

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const user = request.user as
      | {
          id?: string;
          role?: string;
          tenantId?: string;
          membershipId?: string;
        }
      | undefined;

    if (!user?.tenantId || !user.id || !user.role || !user.membershipId) {
      return next.handle();
    }

    return runWithTenantContext(
      {
        tenantId: user.tenantId,
        userId: user.id,
        role: user.role,
        membershipId: user.membershipId,
      },
      () => next.handle(),
    );
  }
}
