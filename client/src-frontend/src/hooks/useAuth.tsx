import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { AuthUser, UserRole } from '@/types';
import { authAPI } from '@/api';

const AuthContext = createContext<{
  user: AuthUser | null;
  login: (email: string, password: string, role?: UserRole) => Promise<void>;
  logout: () => void;
  isLoading: boolean;
  isAuthenticated: boolean;
} | null>(null);

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
        });
      } catch {
        localStorage.removeItem('gymsoins_token');
      }
    }
    setIsLoading(false);
  }, []);

  const login = useCallback(async (email: string, password: string, role?: UserRole) => {
    const response = await authAPI.login(email, password, role);
    const { access_token, role: userRole, permissions, user } = response.data;
    localStorage.setItem('gymsoins_token', access_token);
    setUser({
      id: user.id,
      email: user.email,
      role: userRole,
      permissions,
    });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('gymsoins_token');
    setUser(null);
    window.location.href = '/login';
  }, []);

  const value = {
    user,
    login,
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
