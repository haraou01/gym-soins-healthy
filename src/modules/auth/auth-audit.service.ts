import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';

import { SecurityAuditLog } from './entities/security-audit-log.entity';

export interface AuditEventInput {
  action: string;
  email?: string | null;
  userId?: string | null;
  success: boolean;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}

@Injectable()
export class AuthAuditService {
  private readonly logger = new Logger(AuthAuditService.name);

  constructor(
    @InjectRepository(SecurityAuditLog)
    private readonly auditRepository: Repository<SecurityAuditLog>,
  ) {}

  /**
   * Journalise un événement sensible sans jamais bloquer l'authentification.
   */
  async record(input: AuditEventInput): Promise<void> {
    try {
      await this.auditRepository.save(
        this.auditRepository.create({
          action: input.action,
          email: input.email?.trim().toLowerCase() || null,
          userId: input.userId ?? null,
          success: input.success,
          ip: input.ip?.slice(0, 64) ?? null,
          userAgent: input.userAgent?.slice(0, 500) ?? null,
          metadata: input.metadata ?? null,
        }),
      );
    } catch (error) {
      this.logger.warn(
        `Impossible d'écrire le journal d'audit: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Verrouillage applicatif complémentaire au rate limiting :
   * compte bloqué après N échecs consécutifs dans la fenêtre courante.
   */
  async isLoginLocked(
    email: string,
    maxFailures = 10,
    windowMinutes = 15,
  ): Promise<boolean> {
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
      return false;
    }

    const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000);

    const lastSuccess = await this.auditRepository.findOne({
      where: {
        action: 'LOGIN',
        email: normalizedEmail,
        success: true,
      },
      order: { createdAt: 'DESC' },
    });

    const since =
      lastSuccess && lastSuccess.createdAt > windowStart
        ? lastSuccess.createdAt
        : windowStart;

    const failures = await this.auditRepository.count({
      where: {
        action: 'LOGIN',
        email: normalizedEmail,
        success: false,
        createdAt: MoreThan(since),
      },
    });

    return failures >= maxFailures;
  }
}
