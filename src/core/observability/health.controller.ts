import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { Public } from '../security';

@Controller()
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Public()
  @Get('health')
  health() {
    return {
      status: 'ok',
      role: 'api',
      version: process.env.APP_VERSION || process.env.npm_package_version || '1.0.0',
      commit: process.env.GIT_COMMIT || 'unknown',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @Get('ready')
  async ready() {
    try {
      await this.dataSource.query('SELECT 1');
      return {
        status: 'ready',
        role: 'api',
        version:
          process.env.APP_VERSION || process.env.npm_package_version || '1.0.0',
        commit: process.env.GIT_COMMIT || 'unknown',
        timestamp: new Date().toISOString(),
      };
    } catch {
      throw new ServiceUnavailableException({
        status: 'not_ready',
        reason: 'database_unavailable',
      });
    }
  }
}
