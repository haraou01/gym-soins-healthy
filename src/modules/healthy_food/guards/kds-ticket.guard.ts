import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

import { KdsStreamTicketService } from '../services/kds-stream-ticket.service';

export interface KdsStreamRequest extends Request {
  kdsSession?: {
    userId: string;
    role: string;
    tenantId: string;
  };
}

@Injectable()
export class KdsTicketGuard implements CanActivate {
  constructor(private readonly ticketService: KdsStreamTicketService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<KdsStreamRequest>();
    const raw = request.query.ticket;
    const ticket = Array.isArray(raw) ? raw[0] : raw;
    const session = await this.ticketService.consume(
      typeof ticket === 'string' ? ticket : '',
    );

    if (!session) {
      throw new UnauthorizedException(
        'Ticket SSE invalide, expiré ou déjà utilisé.',
      );
    }

    request.kdsSession = session;
    return true;
  }
}
