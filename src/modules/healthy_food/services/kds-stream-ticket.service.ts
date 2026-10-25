import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes, createHash } from 'node:crypto';
import { MoreThan, Repository } from 'typeorm';

import { KdsStreamTicket } from '../entities/kds-stream-ticket.entity';

export interface KdsStreamSession {
  userId: string;
  role: string;
  tenantId: string;
}

@Injectable()
export class KdsStreamTicketService {
  constructor(
    @InjectRepository(KdsStreamTicket)
    private readonly ticketRepository: Repository<KdsStreamTicket>,
  ) {}

  async create(
    userId: string,
    role: string,
    tenantId: string,
  ): Promise<{ ticket: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 60_000);

    await this.ticketRepository.save(
      this.ticketRepository.create({
        tokenHash: this.hash(token),
        userId,
        role,
        tenantId,
        expiresAt,
      }),
    );

    return { ticket: token, expiresAt };
  }

  /**
   * Consommation atomique : un ticket ne peut être utilisé qu'une fois.
   * PostgreSQL reste la source de vérité, y compris en multi-instance.
   */
  async consume(token: string): Promise<KdsStreamSession | null> {
    if (!token?.trim()) {
      return null;
    }

    const ticket = await this.ticketRepository.findOne({
      where: {
        tokenHash: this.hash(token.trim()),
        usedAt: null,
        expiresAt: MoreThan(new Date()),
      },
    });

    if (!ticket) {
      return null;
    }

    const result = await this.ticketRepository
      .createQueryBuilder()
      .update(KdsStreamTicket)
      .set({ usedAt: new Date() })
      .where('id = :id AND "usedAt" IS NULL AND "expiresAt" > NOW()', {
        id: ticket.id,
      })
      .execute();

    if (!result.affected) {
      return null;
    }

    return {
      userId: ticket.userId,
      role: ticket.role,
      tenantId: ticket.tenantId,
    };
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
