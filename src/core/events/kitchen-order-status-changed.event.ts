/**
 * Événement Outbox émis lorsqu'une commande KDS change de statut.
 */
export const KITCHEN_ORDER_STATUS_CHANGED_EVENT =
  'kitchen.order.status_changed';

export interface KitchenOrderStatusChangedEvent {
  orderId: string;
  clientId: string;
  previousStatus: string;
  status: string;
  type: string;
  updatedAt: string;
}
