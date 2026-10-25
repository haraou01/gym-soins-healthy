import {
  Controller,
  HttpCode,
  HttpStatus,
  MessageEvent,
  Post,
  Req,
  Sse,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import type { Request } from 'express';

import { Public, Roles, RolesGuard } from '../../../core/security';
import {
  KdsStreamRequest,
  KdsTicketGuard,
} from '../guards/kds-ticket.guard';
import { KdsEventsService } from '../services/kds-events.service';
import { KdsStreamTicketService } from '../services/kds-stream-ticket.service';

interface AuthenticatedRequest extends Request {
  user?: { id?: string; role?: string; tenantId?: string };
}

@Controller('api/v1/healthy-food/kds')
export class KdsSseController {
  constructor(
    private readonly ticketService: KdsStreamTicketService,
    private readonly eventsService: KdsEventsService,
  ) {}

  @Post('stream-ticket')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'CHEF')
  async createStreamTicket(@Req() request: AuthenticatedRequest) {
    const user = request.user;

    if (!user?.id || !user.role || !user.tenantId) {
      throw new UnauthorizedException(
        'Utilisateur ou contexte tenant non authentifié.',
      );
    }

    const ticket = await this.ticketService.create(
      user.id,
      user.role,
      user.tenantId,
    );

    return {
      ticket: ticket.ticket,
      expiresAt: ticket.expiresAt.toISOString(),
    };
  }

  /**
   * Flux SSE authentifié par ticket court à usage unique.
   * Le guard consomme le ticket avant l'ouverture du flux, ce qui permet un
   * vrai HTTP 401 sur ticket invalide/expiré/déjà utilisé.
   */
  @Public()
  @UseGuards(KdsTicketGuard)
  @Sse('stream')
  stream(@Req() request: KdsStreamRequest): Observable<MessageEvent> {
    return this.eventsService.stream(request.kdsSession!.tenantId);
  }
}
