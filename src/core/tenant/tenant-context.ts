import { AsyncLocalStorage } from 'node:async_hooks';
import { ForbiddenException } from '@nestjs/common';

export interface TenantContext {
  tenantId: string;
  userId: string;
  role: string;
  membershipId: string;
}

const storage = new AsyncLocalStorage<TenantContext>();

export function runWithTenantContext<T>(
  context: TenantContext,
  callback: () => T,
): T {
  return storage.run(context, callback);
}

export function getTenantContext(): TenantContext | undefined {
  return storage.getStore();
}

export function getTenantId(): string | undefined {
  return storage.getStore()?.tenantId;
}

export function requireTenantId(): string {
  const tenantId = getTenantId();

  if (!tenantId) {
    throw new ForbiddenException('Contexte tenant absent.');
  }

  return tenantId;
}
