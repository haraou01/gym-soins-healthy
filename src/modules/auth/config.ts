import { registerAs } from '@nestjs/config';

// Configuration RBAC Granulaire pour Auth Module
export const authConfig = registerAs('auth', () => ({
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-key-change-in-production',
    expiresIn: parseInt(process.env.JWT_EXPIRES_IN) || '1d',
    refreshSecret: process.env.JWT_REFRESH_SECRET || '',
  },
  // Roles disponibles avec permissions
  roles: {
    admin: ['read:all', 'write:all', 'delete:all'],
    manager: ['read:all', 'write:gym', 'write:booking', 'write:care'],
    coach: ['read:all', 'write:client', 'write:care', 'read:gym'],
    receptionist: ['read:gym', 'write:booking', 'write:reception'],
    therapist: ['read:all', 'write:care', 'write:booking'],
    user: [], // Standard user sans permissions écrtes
  },
  defaultRole: process.env.DEFAULT_ROLE || 'user',
}));
