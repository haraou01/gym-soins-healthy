import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Repository } from 'typeorm';

import {
  TenantMembership,
  TenantMembershipStatus,
  TenantStatus,
} from '../../../core/tenant';

interface JwtPayload {
  sub: string;
  email: string;
  role?: string;
  tenantId?: string;
  membershipId?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    @InjectRepository(TenantMembership)
    private readonly membershipRepository: Repository<TenantMembership>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret') || 'dev-secret-change-me',
    });
  }

  async validate(payload: JwtPayload) {
    if (!payload?.sub || !payload.tenantId || !payload.membershipId) {
      throw new UnauthorizedException('Contexte tenant absent du jeton.');
    }

    const membership = await this.membershipRepository.findOne({
      where: {
        id: payload.membershipId,
        userId: payload.sub,
        tenantId: payload.tenantId,
        status: TenantMembershipStatus.ACTIVE,
      },
      relations: { role: true, tenant: true },
    });

    if (
      !membership ||
      !membership.role ||
      membership.tenant.status !== TenantStatus.ACTIVE
    ) {
      throw new UnauthorizedException(
        'Adhésion ou établissement inactif. Reconnectez-vous.',
      );
    }

    return {
      id: payload.sub,
      email: payload.email,
      role: membership.role.name,
      tenantId: membership.tenantId,
      membershipId: membership.id,
    };
  }
}
