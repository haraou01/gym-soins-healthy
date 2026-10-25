import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  Subscription,
  SubscriptionStatus,
  SubscriptionType,
} from '../entities/subscription.entity';
import {
  AccessLog,
  AccessDirection,
  AccessMethod,
} from '../entities/access-log.entity';

export interface CheckInResult {
  granted: boolean;
  reason?: string;
  accessLog?: AccessLog;
  subscription?: Subscription;
}

@Injectable()
export class GymAccessService {
  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
    @InjectRepository(AccessLog)
    private readonly accessLogRepository: Repository<AccessLog>,
  ) {}

  /**
   * Traite un passage au tourniquet (entrée client).
   *
   * Règles :
   * 1. L'abonnement doit exister, être ACTIF et dans sa fenêtre de validité.
   * 2. Pour un CARNET_SEANCES, le reliquat doit être > 0 (décrémenté à l'entrée).
   * 3. Anti-passback : un client déjà entré (dernier log ENTREE accepté) ne peut pas entrer à nouveau.
   *
   * @param clientId Identifiant du client.
   * @param accessMethod Méthode d'identification utilisée.
   * @returns Résultat du contrôle d'accès.
   */
  async processCheckIn(
    clientId: string,
    accessMethod: AccessMethod,
  ): Promise<CheckInResult> {
    // 1. Récupérer l'abonnement actif du client
    const subscription = await this.subscriptionRepository.findOne({
      where: {
        clientId,
        status: SubscriptionStatus.ACTIF,
      },
    });

    if (!subscription) {
      return await this.logAccess(
        clientId,
        AccessDirection.ENTREE,
        accessMethod,
        false,
        'Aucun abonnement actif trouvé',
      );
    }

    // 2. Vérifier validité temporelle
    if (!subscription.isActive()) {
      await this.subscriptionRepository.update(subscription.id, {
        status: SubscriptionStatus.EXPIRE,
      });
      return await this.logAccess(
        clientId,
        AccessDirection.ENTREE,
        accessMethod,
        false,
        'Abonnement expiré',
      );
    }

    // 3. Vérifier disponibilité de sessions (carnet uniquement)
    if (!subscription.hasSessionsAvailable()) {
      return await this.logAccess(
        clientId,
        AccessDirection.ENTREE,
        accessMethod,
        false,
        'Crédit de séances épuisé',
      );
    }

    // 4. Anti-passback : dernier accès accepté du client
    const lastAccess = await this.findLastGrantedAccess(clientId);

    if (lastAccess && lastAccess.direction === AccessDirection.ENTREE) {
      return await this.logAccess(
        clientId,
        AccessDirection.ENTREE,
        accessMethod,
        false,
        'Anti-passback : client déjà à l\'intérieur',
      );
    }

    // 5. Accès accordé : décrémenter le carnet si applicable
    if (subscription.type === SubscriptionType.CARNET_SEANCES) {
      subscription.remainingSessions -= 1;
      await this.subscriptionRepository.save(subscription);
    }

    return await this.logAccess(
      clientId,
      AccessDirection.ENTREE,
      accessMethod,
      true,
      undefined,
      subscription,
    );
  }

  /**
   * Traite une sortie client.
   *
   * Règle anti-passback : on ne peut sortir que si le dernier accès accepté était une entrée.
   */
  async processCheckOut(
    clientId: string,
    accessMethod: AccessMethod,
  ): Promise<CheckInResult> {
    const lastAccess = await this.findLastGrantedAccess(clientId);

    if (!lastAccess || lastAccess.direction === AccessDirection.SORTIE) {
      return await this.logAccess(
        clientId,
        AccessDirection.SORTIE,
        accessMethod,
        false,
        'Anti-passback : client n\'est pas à l\'intérieur',
      );
    }

    return await this.logAccess(
      clientId,
      AccessDirection.SORTIE,
      accessMethod,
      true,
    );
  }

  async getActiveSubscription(clientId: string): Promise<Subscription | null> {
    const subscription = await this.subscriptionRepository.findOne({
      where: {
        clientId,
        status: SubscriptionStatus.ACTIF,
      },
    });

    if (!subscription || !subscription.isActive()) {
      return null;
    }

    return subscription;
  }

  /** Derniers passages au tourniquet (entrées et sorties), du plus récent au plus ancien. */
  async findRecentAccessLogs(limit = 50): Promise<AccessLog[]> {
    return this.accessLogRepository.find({
      order: { timestamp: 'DESC' },
      take: limit,
    });
  }

  /**
   * Dernier accès réellement accepté du client.
   *
   * Les tentatives refusées (`granted: false`) sont conservées pour l'audit,
   * mais elles ne participent jamais à l'état anti-passback.
   */
  private findLastGrantedAccess(clientId: string): Promise<AccessLog | null> {
    return this.accessLogRepository.findOne({
      where: { clientId, granted: true },
      order: { timestamp: 'DESC' },
    });
  }

  /**
   * Enregistre un journal d'accès et retourne le résultat normalisé.
   */
  private async logAccess(
    clientId: string,
    direction: AccessDirection,
    method: AccessMethod,
    granted: boolean,
    reason?: string,
    subscription?: Subscription,
  ): Promise<CheckInResult> {
    const accessLog = this.accessLogRepository.create({
      clientId,
      direction,
      timestamp: new Date(),
      method,
      granted,
      reason,
    });

    await this.accessLogRepository.save(accessLog);

    return {
      granted,
      reason,
      accessLog,
      subscription,
    };
  }
}
