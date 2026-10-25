import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import {
  SALE_COMPLETED_EVENT,
  type SaleCompletedEvent,
} from '../../../core/events';
import { LoyaltyTransactionType } from '../entities';
import { LoyaltyService } from '../services/loyalty.service';

/**
 * Consommateur optionnel de l'événement `sale.completed`.
 *
 * Le module Shop ne connaît pas Loyalty. Si LoyaltyModule est retiré de la
 * composition Nest, cet écouteur n'existe plus et la vente continue normalement.
 */
@Injectable()
export class SaleCompletedListener {
  private readonly logger = new Logger(SaleCompletedListener.name);

  constructor(private readonly loyaltyService: LoyaltyService) {}

  @OnEvent(SALE_COMPLETED_EVENT, {
    async: true,
    suppressErrors: true,
  })
  async handleSaleCompleted(event: SaleCompletedEvent): Promise<void> {
    if (!event.clientId || event.totalCents <= 0) {
      return;
    }

    // Politique fidélité locale : 1 point par euro, minimum 1 point.
    const points = Math.max(1, Math.floor(event.totalCents / 100));

    try {
      await this.loyaltyService.credit({
        clientId: event.clientId,
        points,
        type: LoyaltyTransactionType.GAIN_ACHAT,
        description: `Achat boutique #${event.saleId}`,
      });
    } catch (error) {
      // Un incident de fidélité ne doit jamais remonter dans le flux de vente.
      this.logger.warn(
        `Échec du crédit de fidélité pour la vente ${event.saleId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
