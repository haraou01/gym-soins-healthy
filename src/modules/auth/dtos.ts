import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

import type { Role } from './permissions';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsOptional()
  @IsString({ each: true })
  permissions?: string[];

  /** Tenant demandé : validé contre une adhésion active côté serveur. */
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  /** Champ historique envoyé par le frontend, ignoré par le service de login. */
  @IsOptional()
  @IsIn(['SUPER_ADMIN', 'RECEPTIONIST', 'COACH', 'THERAPIST', 'CHEF'])
  role?: Role;
}

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsString()
  @IsNotEmpty()
  username: string;

  /** Nom du nouvel établissement créé par l'inscription self-service. */
  @IsOptional()
  @IsString()
  @MinLength(2)
  tenantName?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsIn(['SUPER_ADMIN', 'RECEPTIONIST', 'COACH', 'THERAPIST', 'CHEF'])
  role?: Role = 'RECEPTIONIST';
}

export class SwitchTenantDto {
  @IsUUID()
  tenantId: string;
}
