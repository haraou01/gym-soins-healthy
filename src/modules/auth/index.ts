import type { Role } from './permissions';
import { RBAC_PERMISSIONS } from './permissions';

export type { Role };

export interface RegistrationDto {
  email: string;
  password: string;
  username: string;
  tenantName?: string;
  phone?: string;
  role?: Role;
}

export interface LoginResponse {
  access_token: string;
  role: string;
  permissions: Array<{ resource: string; actions: string[] }>;
  user: { id: string; email: string };
  tenant: {
    id: string;
    slug: string;
    name: string;
    role: string;
  };
  tenants: Array<{
    id: string;
    slug: string;
    name: string;
    role: string;
  }>;
}

export { RBAC_PERMISSIONS };
