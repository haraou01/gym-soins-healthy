import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';

import {
  Subscription,
  SubscriptionStatus,
  SubscriptionType,
} from '../entities/subscription.entity';
import {
  AccessDirection,
  AccessLog,
  AccessMethod,
} from '../entities/access-log.entity';

@Injectable()
export class GymService {
  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
    @InjectRepository(AccessLog)
    private readonly accessLogRepository: Repository<AccessLog>,
  ) {}

  /**
   * Contrôle d'accès simplifié pour un client.
   *
   * Adaptation TypeORM du service Prisma fourni :
   * - `userId` correspond à `Subscription.clientId` ;
   * - `CREDITS` correspond à `SubscriptionType.CARNET_SEANCES` ;
   * - `credits` correspond à `remainingSessions`.
   *
   * Le flux tourniquet existant (`GymAccessService.processCheckIn`) reste
   * disponible avec son anti-passback et sa gestion entrée/sortie ; seuls les
   * accès acceptés (`granted: true`) y font foi pour l'état présent/absent.
   */
  async checkAccess(
    userId: string,
    method: AccessMethod = AccessMethod.MANUEL,
  ): Promise<{ success: true; message: string }> {
    const now = new Date();

    const subscription = await this.subscriptionRepository.findOne({
      where: {
        clientId: userId,
        status: SubscriptionStatus.ACTIF,
        startDate: LessThanOrEqual(now),
        endDate: MoreThanOrEqual(now),
      },
      order: { endDate: 'DESC' },
    });

    if (!subscription) {
      await this.logAccess(
        userId,
        false,
        'SUBSCRIPTION_EXPIRED_OR_MISSING',
        method,
      );
      throw new ForbiddenException('Accès refusé : Aucun abonnement actif.');
    }

    if (
      subscription.type === SubscriptionType.CARNET_SEANCES &&
      subscription.remainingSessions <= 0
    ) {
      await this.logAccess(userId, false, 'ZERO_CREDITS_LEFT', method);
      throw new ForbiddenException('Accès refusé : Crédits épuisés.');
    }

    if (subscription.type === SubscriptionType.CARNET_SEANCES) {
      subscription.remainingSessions -= 1;
      await this.subscriptionRepository.save(subscription);
    }

    await this.logAccess(userId, true, 'ACCESS_GRANTED', method);

    return { success: true, message: 'Accès autorisé. Bienvenue !' };
  }

  async findAllSubscriptions(): Promise<Subscription[]> {
    return this.subscriptionRepository.find({ order: { createdAt: 'DESC' } });
  }

  async findSubscriptionById(id: string): Promise<Subscription> {
    const subscription = await this.subscriptionRepository.findOne({ where: { id } });

    if (!subscription) {
      throw new NotFoundException(`Abonnement ${id} introuvable`);
    }

    return subscription;
  }

  async createSubscription(data: Partial<Subscription>): Promise<Subscription> {
    const subscription = this.subscriptionRepository.create(data);
    return this.subscriptionRepository.save(subscription);
  }

  async updateSubscription(id: string, data: Partial<Subscription>): Promise<Subscription> {
    await this.findSubscriptionById(id);
    await this.subscriptionRepository.update(id, data);
    return this.findSubscriptionById(id);
  }

  async deleteSubscription(id: string): Promise<void> {
    const subscription = await this.findSubscriptionById(id);
    await this.subscriptionRepository.remove(subscription);
  }

  /**
   * Journalise une tentative d'accès en respectant le schéma `AccessLog`
   * existant (direction, horodatage et méthode obligatoires).
   */
  private async logAccess(
    clientId: string,
    granted: boolean,
    reason: string,
    method: AccessMethod,
  ): Promise<void> {
    const accessLog = this.accessLogRepository.create({
      clientId,
      direction: AccessDirection.ENTREE,
      timestamp: new Date(),
      method,
      granted,
      reason,
    });

    await this.accessLogRepository.save(accessLog);
  }
}
