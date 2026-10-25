import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';

import {
  SALE_COMPLETED_EVENT,
  type SaleCompletedEvent,
} from '../../../core/events';
import {
  IdempotencyService,
  IDEMPOTENCY_SCOPES,
} from '../../../core/idempotency';
import { LoyaltyTransactionType } from '../entities';
import { LoyaltyService } from '../services/loyalty.service';

/**
 * Consommateur optionnel de l'événement `sale.completed`.
 *
 * Le module Shop ne connaît pas Loyalty. Si LoyaltyModule est retiré de la
 * composition Nest, cet écouteur n'existe plus et la vente continue normalement.
 *
 * Le crédit est idempotent : une reprise du worker outbox avec le même saleId
 * ne crédite pas deux fois le client.
 */
@Injectable()
export class SaleCompletedListener {
  private readonly logger = new Logger(SaleCompletedListener.name);

  constructor(
    private readonly loyaltyService: LoyaltyService,
    private readonly dataSource: DataSource,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  @OnEvent(SALE_COMPLETED_EVENT, { suppressErrors: false })
  async handleSaleCompleted(event: SaleCompletedEvent): Promise<void> {
    if (!event.clientId || event.totalCents <= 0) {
      return;
    }

    // Politique fidélité locale : 1 point par euro, minimum 1 point.
    const points = Math.max(1, Math.floor(event.totalCents / 100));

    await this.dataSource.transaction(async (manager) => {
      await this.idempotencyService.execute(
        manager,
        IDEMPOTENCY_SCOPES.LOYALTY_SALE_COMPLETED,
        event.saleId,
        event,
        async () => {
          await this.loyaltyService.credit(
            {
              clientId: event.clientId as string,
              points,
              type: LoyaltyTransactionType.GAIN_ACHAT,
              description: `Achat boutique #${event.saleId}`,
            },
            manager,
          );

          return { credited: true };
        },
      );
    });

    this.logger.debug(
      `Fidélité créditée pour la vente ${event.saleId} (${points} points).`,
    );
  }
}
