import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  Tenant,
  TenantMembership,
  TenantMembershipStatus,
  TenantStatus,
} from './entities';

@Injectable()
export class TenantService {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
    @InjectRepository(TenantMembership)
    private readonly membershipRepository: Repository<TenantMembership>,
  ) {}

  async findActiveMemberships(userId: string): Promise<TenantMembership[]> {
    return this.membershipRepository
      .createQueryBuilder('membership')
      .innerJoinAndSelect('membership.tenant', 'tenant')
      .innerJoinAndSelect('membership.role', 'role')
      .where('membership.userId = :userId', { userId })
      .andWhere('membership.status = :status', {
        status: TenantMembershipStatus.ACTIVE,
      })
      .andWhere('tenant.status = :tenantStatus', {
        tenantStatus: TenantStatus.ACTIVE,
      })
      .orderBy('membership.createdAt', 'ASC')
      .getMany();
  }

  async findMembership(
    userId: string,
    tenantId: string,
  ): Promise<TenantMembership | null> {
    return this.membershipRepository
      .createQueryBuilder('membership')
      .innerJoinAndSelect('membership.tenant', 'tenant')
      .innerJoinAndSelect('membership.role', 'role')
      .where('membership.userId = :userId', { userId })
      .andWhere('membership.tenantId = :tenantId', { tenantId })
      .andWhere('membership.status = :status', {
        status: TenantMembershipStatus.ACTIVE,
      })
      .andWhere('tenant.status = :tenantStatus', {
        tenantStatus: TenantStatus.ACTIVE,
      })
      .getOne();
  }

  async getTenant(tenantId: string): Promise<Tenant> {
    const tenant = await this.tenantRepository.findOne({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant ${tenantId} introuvable`);
    }

    return tenant;
  }

  async listMembers(tenantId: string) {
    const memberships = await this.membershipRepository.find({
      where: { tenantId },
      relations: { user: true, role: true },
      order: { createdAt: 'ASC' },
    });

    return memberships.map((membership) => ({
      id: membership.id,
      status: membership.status,
      createdAt: membership.createdAt,
      user: {
        id: membership.user.id,
        email: membership.user.email,
        username: membership.user.username,
      },
      role: membership.role.name,
    }));
  }
}
