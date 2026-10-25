import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { AuthUser, TenantSummary, UserRole } from '@/types';
import { authAPI } from '@/api';

interface AuthContextValue {
  user: AuthUser | null;
  login: (email: string, password: string, tenantId?: string) => Promise<void>;
  register: (data: {
    email: string;
    password: string;
    username: string;
    tenantName: string;
  }) => Promise<void>;
  switchTenant: (tenantId: string) => Promise<void>;
  logout: () => void;
  isLoading: boolean;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function userFromResponse(response: {
  role: UserRole;
  permissions: unknown;
  user: { id: string; email: string };
  tenant: TenantSummary;
  tenants: TenantSummary[];
}): AuthUser {
  return {
    id: response.user.id,
    email: response.user.email,
    role: response.role,
    permissions: Array.isArray(response.permissions)
      ? (response.permissions as string[])
      : [],
    tenantId: response.tenant.id,
    tenantName: response.tenant.name,
    tenants: response.tenants,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('gymsoins_token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1] ?? ''));
        setUser({
          id: payload.sub,
          email: payload.email,
          role: payload.role as UserRole,
          permissions: payload.permissions ?? [],
          tenantId: payload.tenantId,
        });

        void authAPI
          .getTenants()
          .then((response) => {
            const tenants = response.data;
            const current = tenants.find((tenant) => tenant.id === payload.tenantId);

            setUser((previous) =>
              previous
                ? {
                    ...previous,
                    tenants,
                    tenantId: current?.id ?? previous.tenantId,
                    tenantName: current?.name ?? previous.tenantName,
                  }
                : previous,
            );
          })
          .catch(() => undefined);
      } catch {
        localStorage.removeItem('gymsoins_token');
      }
    }
    setIsLoading(false);
  }, []);

  const login = useCallback(
    async (email: string, password: string, tenantId?: string) => {
      const response = await authAPI.login(email, password, tenantId);
      localStorage.setItem('gymsoins_token', response.data.access_token);
      setUser(userFromResponse(response.data));
    },
    [],
  );

  const register = useCallback(
    async (data: {
      email: string;
      password: string;
      username: string;
      tenantName: string;
    }) => {
      const response = await authAPI.register(data);
      localStorage.setItem('gymsoins_token', response.data.access_token);
      setUser(userFromResponse(response.data));
    },
    [],
  );

  const switchTenant = useCallback(async (tenantId: string) => {
    const response = await authAPI.switchTenant(tenantId);
    localStorage.setItem('gymsoins_token', response.data.access_token);
    setUser(userFromResponse(response.data));
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('gymsoins_token');
    setUser(null);
    window.location.href = '/login';
  }, []);

  const value = {
    user,
    login,
    register,
    switchTenant,
    logout,
    isLoading,
    isAuthenticated: !!user,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth doit être utilisé à l’intérieur de AuthProvider');
  }
  return context;
}
