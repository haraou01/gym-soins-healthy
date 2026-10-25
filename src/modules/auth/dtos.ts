import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

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

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsIn(['SUPER_ADMIN', 'RECEPTIONIST', 'COACH', 'THERAPIST', 'CHEF'])
  role?: Role = 'RECEPTIONIST';
}
