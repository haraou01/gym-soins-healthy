import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';

import type { LoginResponse, RegistrationDto, Role } from './index';
import { AuthAuditService } from './auth-audit.service';
import { RBAC_PERMISSIONS } from './permissions';
import { RoleEntity } from './entities/role.entity';
import { User } from './entities/user.entity';

const BCRYPT_ROUNDS = 10;
const MAX_LOGIN_FAILURES = 10;
const LOGIN_LOCK_WINDOW_MINUTES = 15;

export interface AuthRequestContext {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  private readonly loginEmailMaxAttempts: number;
  private readonly loginIpMaxAttempts: number;
  private readonly loginRateWindowSeconds: number;
  private readonly registerEmailMaxAttempts: number;
  private readonly registerIpMaxAttempts: number;
  private readonly registerRateWindowSeconds: number;
  private readonly refreshIpMaxAttempts: number;
  private readonly refreshRateWindowSeconds: number;

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(RoleEntity)
    private readonly roleRepository: Repository<RoleEntity>,
    private readonly jwtService: JwtService,
    private readonly authAuditService: AuthAuditService,
    configService: ConfigService,
  ) {
    this.loginEmailMaxAttempts = this.readNumber(
      configService,
      'AUTH_LOGIN_EMAIL_MAX_ATTEMPTS',
      20,
    );
    this.loginIpMaxAttempts = this.readNumber(
      configService,
      'AUTH_LOGIN_IP_MAX_ATTEMPTS',
      30,
    );
    this.loginRateWindowSeconds = this.readNumber(
      configService,
      'AUTH_LOGIN_RATE_WINDOW_SECONDS',
      60,
    );
    this.registerEmailMaxAttempts = this.readNumber(
      configService,
      'AUTH_REGISTER_EMAIL_MAX_ATTEMPTS',
      5,
    );
    this.registerIpMaxAttempts = this.readNumber(
      configService,
      'AUTH_REGISTER_IP_MAX_ATTEMPTS',
      5,
    );
    this.registerRateWindowSeconds = this.readNumber(
      configService,
      'AUTH_REGISTER_RATE_WINDOW_SECONDS',
      3600,
    );
    this.refreshIpMaxAttempts = this.readNumber(
      configService,
      'AUTH_REFRESH_IP_MAX_ATTEMPTS',
      30,
    );
    this.refreshRateWindowSeconds = this.readNumber(
      configService,
      'AUTH_REFRESH_RATE_WINDOW_SECONDS',
      60,
    );
  }

  async login(
    email: string,
    password: string,
    context: AuthRequestContext = {},
  ): Promise<LoginResponse> {
    const normalizedEmail = email.trim().toLowerCase();

    await this.enforceRateLimit(
      'LOGIN',
      normalizedEmail,
      context.ip,
      this.loginEmailMaxAttempts,
      this.loginIpMaxAttempts,
      this.loginRateWindowSeconds,
    );

    if (
      await this.authAuditService.isLoginLocked(
        normalizedEmail,
        MAX_LOGIN_FAILURES,
        LOGIN_LOCK_WINDOW_MINUTES,
      )
    ) {
      await this.authAuditService.record({
        action: 'LOGIN',
        email: normalizedEmail,
        success: false,
        ip: context.ip,
        userAgent: context.userAgent,
        metadata: { reason: 'ACCOUNT_LOCKED' },
      });

      throw new HttpException(
        'Trop de tentatives de connexion. Réessayez dans quelques minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.findActiveUserByEmail(normalizedEmail);

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      await this.authAuditService.record({
        action: 'LOGIN',
        email: normalizedEmail,
        success: false,
        ip: context.ip,
        userAgent: context.userAgent,
        metadata: { reason: 'INVALID_CREDENTIALS' },
      });

      throw new UnauthorizedException('Identifiants invalides');
    }

    await this.authAuditService.record({
      action: 'LOGIN',
      email: normalizedEmail,
      userId: user.id,
      success: true,
      ip: context.ip,
      userAgent: context.userAgent,
    });

    return this.buildLoginResponse(user);
  }

  async register(
    userData: RegistrationDto,
    context: AuthRequestContext = {},
  ): Promise<LoginResponse> {
    const email = userData.email.trim().toLowerCase();

    await this.enforceRateLimit(
      'REGISTER',
      email,
      context.ip,
      this.registerEmailMaxAttempts,
      this.registerIpMaxAttempts,
      this.registerRateWindowSeconds,
    );

    const existing = await this.userRepository.findOne({ where: { email } });

    if (existing) {
      await this.authAuditService.record({
        action: 'REGISTER',
        email,
        success: false,
        ip: context.ip,
        userAgent: context.userAgent,
        metadata: { reason: 'EMAIL_ALREADY_USED' },
      });

      throw new BadRequestException('Cet email est déjà utilisé');
    }

    const roleName: Role = userData.role ?? 'RECEPTIONIST';
    const role = await this.roleRepository.findOne({
      where: { name: roleName },
    });

    if (!role) {
      await this.authAuditService.record({
        action: 'REGISTER',
        email,
        success: false,
        ip: context.ip,
        userAgent: context.userAgent,
        metadata: { reason: 'UNKNOWN_ROLE', role: roleName },
      });

      throw new BadRequestException(`Rôle inconnu : ${roleName}`);
    }

    const user = await this.userRepository.save(
      this.userRepository.create({
        email,
        username: userData.username?.trim() || null,
        passwordHash: await bcrypt.hash(userData.password, BCRYPT_ROUNDS),
        role,
        isActive: true,
      }),
    );

    await this.authAuditService.record({
      action: 'REGISTER',
      email,
      userId: user.id,
      success: true,
      ip: context.ip,
      userAgent: context.userAgent,
    });

    return this.buildLoginResponse(user);
  }

  async refreshToken(
    _refreshToken: string,
    context: AuthRequestContext = {},
  ): Promise<LoginResponse> {
    await this.enforceRateLimit(
      'REFRESH',
      undefined,
      context.ip,
      undefined,
      this.refreshIpMaxAttempts,
      this.refreshRateWindowSeconds,
    );

    await this.authAuditService.record({
      action: 'REFRESH',
      success: false,
      ip: context.ip,
      userAgent: context.userAgent,
      metadata: { reason: 'REFRESH_TOKEN_NOT_SUPPORTED' },
    });

    throw new UnauthorizedException('Refresh token invalide');
  }

  /** --- Helpers --- */

  private async enforceRateLimit(
    action: string,
    email: string | undefined,
    ip: string | undefined,
    emailMaxAttempts: number | undefined,
    ipMaxAttempts: number | undefined,
    windowSeconds: number,
  ): Promise<void> {
    const limited = await this.authAuditService.isRateLimited(
      action,
      { email, ip },
      { email: emailMaxAttempts, ip: ipMaxAttempts },
      windowSeconds,
    );

    if (!limited) {
      return;
    }

    await this.authAuditService.record({
      action,
      email: email ?? null,
      success: false,
      ip: ip ?? null,
      metadata: { reason: 'RATE_LIMITED' },
    });

    throw new HttpException(
      'Trop de tentatives. Réessayez dans quelques minutes.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private readNumber(
    configService: ConfigService,
    key: string,
    fallback: number,
  ): number {
    const raw = configService.get<string | number>(key);
    const value = Number(raw);

    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  private async findActiveUserByEmail(email: string): Promise<User | null> {
    const user = await this.userRepository.findOne({
      where: { email: email.trim().toLowerCase() },
      relations: { role: true },
    });

    if (!user || !user.isActive || !user.role) {
      return null;
    }

    return user;
  }

  private async buildLoginResponse(user: User): Promise<LoginResponse> {
    const role = user.role?.name as Role;
    const permissions = RBAC_PERMISSIONS[role] ?? [];

    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      role,
    });

    return {
      access_token: accessToken,
      role,
      permissions,
      user: { id: user.id, email: user.email },
    };
  }
}
