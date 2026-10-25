import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Param,
  Query,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';

import { GymService } from '../services/gym.service';
import { GymAccessService } from '../services/gym-access.service';
import { SubscriptionStatus } from '../entities/subscription.entity';
import {
  CheckInDto,
  CheckOutDto,
  CreateSubscriptionDto,
  UpdateSubscriptionDto,
} from '../dto';

@Controller('api/v1/gym')
export class GymController {
  constructor(
    private readonly gymService: GymService,
    private readonly gymAccessService: GymAccessService,
  ) {}

  /** Passage au tourniquet : entrée client. */
  @Post('check-in')
  async checkIn(@Body() dto: CheckInDto) {
    return this.gymAccessService.processCheckIn(dto.clientId, dto.method);
  }

  /** Passage au tourniquet : sortie client. */
  @Post('check-out')
  async checkOut(@Body() dto: CheckOutDto) {
    return this.gymAccessService.processCheckOut(dto.clientId, dto.method);
  }

  /** Liste de tous les abonnements. */
  @Get('subscriptions')
  async findAllSubscriptions() {
    return this.gymService.findAllSubscriptions();
  }

  /** Derniers passages au tourniquet (journal d'accès). */
  @Get('access-logs')
  async findRecentAccessLogs(@Query('limit') limit?: string) {
    const parsed = limit === undefined ? 50 : Number(limit);

    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
      throw new BadRequestException('limit doit être un entier entre 1 et 200');
    }

    return this.gymAccessService.findRecentAccessLogs(parsed);
  }

  /** Détail d'un abonnement par ID. */
  @Get('subscriptions/:id')
  async getSubscription(@Param('id') id: string) {
    try {
      return await this.gymService.findSubscriptionById(id);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new NotFoundException(`Abonnement ${id} introuvable`);
    }
  }

  /** Créer un nouvel abonnement. */
  @Post('subscriptions')
  async createSubscription(@Body() dto: CreateSubscriptionDto) {
    return this.gymService.createSubscription({
      clientId: dto.clientId,
      type: dto.type,
      startDate: new Date(dto.startDate),
      endDate: new Date(dto.endDate),
      remainingSessions: dto.remainingSessions ?? 0,
      status: SubscriptionStatus.ACTIF,
    });
  }

  /** Suspendre, réactiver ou expirer un abonnement. */
  @Put('subscriptions/:id')
  async updateSubscription(
    @Param('id') id: string,
    @Body() dto: UpdateSubscriptionDto,
  ) {
    try {
      return await this.gymService.updateSubscription(id, {
        status: dto.status,
      });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new NotFoundException(`Abonnement ${id} introuvable`);
    }
  }

  /** Récupérer l'abonnement actif d'un client. */
  @Get('subscriptions/:clientId/active')
  async getActiveSubscription(@Param('clientId') clientId: string) {
    const subscription = await this.gymAccessService.getActiveSubscription(clientId);

    if (!subscription) {
      throw new NotFoundException(`Aucun abonnement actif pour le client ${clientId}`);
    }

    return subscription;
  }
}
