import {
  Controller,
  HttpCode,
  HttpStatus,
  MessageEvent,
  Post,
  Query,
  Req,
  Sse,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable, from, switchMap, throwError } from 'rxjs';

import { Public, Roles, RolesGuard } from '../../../core/security';
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

    if (!user?.id || !user.role) {
      throw new UnauthorizedException('Utilisateur non authentifié.');
    }

    const ticket = await this.ticketService.create(
      user.id,
      user.role,
      user.tenantId ?? 'default',
    );

    return {
      ticket: ticket.ticket,
      expiresAt: ticket.expiresAt.toISOString(),
    };
  }

  /**
   * Flux SSE authentifié par ticket court à usage unique.
   * Aucun JWT longue durée dans l'URL.
   */
  @Public()
  @Sse('stream')
  stream(@Query('ticket') ticket?: string): Observable<MessageEvent> {
    return from(this.ticketService.consume(ticket ?? '')).pipe(
      switchMap((session) => {
        if (!session) {
          return throwError(
            () =>
              new UnauthorizedException(
                'Ticket SSE invalide, expiré ou déjà utilisé.',
              ),
          );
        }

        return this.eventsService.stream(session.tenantId);
      }),
    );
  }
}
