import { Controller, Get, UseGuards } from '@nestjs/common';

import { Roles, RolesGuard } from '../security';
import { requireTenantId } from './tenant-context';
import { TenantService } from './tenant.service';

@Controller('api/v1/tenant')
@UseGuards(RolesGuard)
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  @Get('current')
  async current() {
    const tenantId = requireTenantId();
    return this.tenantService.getTenant(tenantId);
  }

  @Get('members')
  @Roles('SUPER_ADMIN')
  async members() {
    return this.tenantService.listMembers(requireTenantId());
  }
}
