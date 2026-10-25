import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { DataSource, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';

import { metrics } from '../../core/observability/metrics.registry';
import {
  Tenant,
  TenantMembership,
  TenantMembershipStatus,
  TenantStatus,
  TenantService,
} from '../../core/tenant';
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

export interface TenantSummary {
  id: string;
  slug: string;
  name: string;
  role: string;
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
    private readonly tenantService: TenantService,
    private readonly dataSource: DataSource,
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
    requestedTenantId?: string,
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
      metrics.inc('auth_account_locked_total');
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

    const memberships = await this.tenantService.findActiveMemberships(user.id);

    if (memberships.length === 0) {
      await this.authAuditService.record({
        action: 'LOGIN',
        email: normalizedEmail,
        userId: user.id,
        success: false,
        ip: context.ip,
        userAgent: context.userAgent,
        metadata: { reason: 'NO_TENANT_MEMBERSHIP' },
      });

      throw new UnauthorizedException(
        'Aucun établissement actif associé à cet utilisateur.',
      );
    }

    let membership: TenantMembership | undefined;

    if (requestedTenantId) {
      membership = memberships.find(
        (candidate) => candidate.tenantId === requestedTenantId,
      );

      if (!membership) {
        await this.authAuditService.record({
          action: 'LOGIN',
          email: normalizedEmail,
          userId: user.id,
          success: false,
          ip: context.ip,
          userAgent: context.userAgent,
          metadata: {
            reason: 'TENANT_ACCESS_DENIED',
            requestedTenantId,
          },
        });

        throw new ForbiddenException(
          'Accès à cet établissement refusé.',
        );
      }
    } else if (memberships.length === 1) {
      membership = memberships[0];
    } else {
      await this.authAuditService.record({
        action: 'LOGIN',
        email: normalizedEmail,
        userId: user.id,
        success: false,
        ip: context.ip,
        userAgent: context.userAgent,
        metadata: { reason: 'TENANT_SELECTION_REQUIRED' },
      });

      throw new ConflictException({
        code: 'TENANT_SELECTION_REQUIRED',
        message:
          'Plusieurs établissements sont associés à ce compte. Sélectionnez un tenant.',
        tenants: memberships.map((candidate) => this.toTenantSummary(candidate)),
      });
    }

    await this.authAuditService.record({
      action: 'LOGIN',
      email: normalizedEmail,
      userId: user.id,
      tenantId: membership.tenantId,
      success: true,
      ip: context.ip,
      userAgent: context.userAgent,
    });

    return this.buildLoginResponse(user, membership, memberships);
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

    const ownerRole = await this.roleRepository.findOne({
      where: { name: 'SUPER_ADMIN' },
    });

    if (!ownerRole) {
      throw new BadRequestException('Rôle SUPER_ADMIN indisponible');
    }

    const tenantName =
      userData.tenantName?.trim() || `${userData.username.trim()} tenant`;
    const slug = this.buildTenantSlug(tenantName);

    const outcome = await this.dataSource.transaction(async (manager) => {
      const tenant = await manager.getRepository(Tenant).save(
        manager.getRepository(Tenant).create({
          name: tenantName,
          slug,
          status: TenantStatus.ACTIVE,
        }),
      );

      const user = await manager.getRepository(User).save(
        manager.getRepository(User).create({
          email,
          username: userData.username?.trim() || null,
          passwordHash: await bcrypt.hash(userData.password, BCRYPT_ROUNDS),
          role: ownerRole,
          isActive: true,
        }),
      );

      const membership = await manager.getRepository(TenantMembership).save(
        manager.getRepository(TenantMembership).create({
          tenantId: tenant.id,
          userId: user.id,
          roleId: ownerRole.id,
          status: TenantMembershipStatus.ACTIVE,
        }),
      );

      const hydratedMembership = await manager
        .getRepository(TenantMembership)
        .findOne({
          where: { id: membership.id },
          relations: { tenant: true, role: true },
        });

      return { tenant, user, membership: hydratedMembership ?? membership };
    });

    await this.authAuditService.record({
      action: 'REGISTER',
      email,
      userId: outcome.user.id,
      tenantId: outcome.tenant.id,
      success: true,
      ip: context.ip,
      userAgent: context.userAgent,
      metadata: { tenantSlug: outcome.tenant.slug, firstAdmin: true },
    });

    return this.buildLoginResponse(outcome.user, outcome.membership, [
      outcome.membership,
    ]);
  }

  async switchTenant(
    userId: string,
    tenantId: string,
    context: AuthRequestContext = {},
  ): Promise<LoginResponse> {
    const user = await this.userRepository.findOne({
      where: { id: userId, isActive: true },
    });

    if (!user) {
      throw new UnauthorizedException('Utilisateur introuvable ou inactif.');
    }

    const membership = await this.tenantService.findMembership(userId, tenantId);

    if (!membership) {
      throw new ForbiddenException('Accès à cet établissement refusé.');
    }

    const memberships = await this.tenantService.findActiveMemberships(userId);

    await this.authAuditService.record({
      action: 'TENANT_SWITCH',
      email: user.email,
      userId: user.id,
      tenantId: membership.tenantId,
      success: true,
      ip: context.ip,
      userAgent: context.userAgent,
    });

    return this.buildLoginResponse(user, membership, memberships);
  }

  async getTenants(userId: string): Promise<TenantSummary[]> {
    const memberships = await this.tenantService.findActiveMemberships(userId);

    return memberships.map((membership) => this.toTenantSummary(membership));
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
    return this.userRepository.findOne({
      where: { email: email.trim().toLowerCase(), isActive: true },
      relations: { role: true },
    });
  }

  private async buildLoginResponse(
    user: User,
    membership: TenantMembership,
    memberships: TenantMembership[],
  ): Promise<LoginResponse> {
    const role = membership.role.name as Role;
    const permissions = RBAC_PERMISSIONS[role] ?? [];

    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      role,
      tenantId: membership.tenantId,
      membershipId: membership.id,
    });

    return {
      access_token: accessToken,
      role,
      permissions,
      user: { id: user.id, email: user.email },
      tenant: this.toTenantSummary(membership),
      tenants: memberships.map((candidate) => this.toTenantSummary(candidate)),
    };
  }

  private toTenantSummary(membership: TenantMembership): TenantSummary {
    return {
      id: membership.tenantId,
      slug: membership.tenant.slug,
      name: membership.tenant.name,
      role: membership.role.name,
    };
  }

  private buildTenantSlug(name: string): string {
    const base =
      name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'tenant';

    return `${base}-${randomUUID().slice(0, 8)}`;
  }
}
