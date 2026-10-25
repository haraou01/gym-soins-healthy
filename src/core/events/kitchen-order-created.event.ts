/**
 * Événement optionnel émis après la création d'une commande cuisine.
 *
 * Aucun module consommateur n'est requis : stock, caisse ou analytics peuvent
 * s'y abonner sans que Healthy Food ne les connaisse.
 */
export const KITCHEN_ORDER_CREATED_EVENT = 'kitchen.order.created';

export interface KitchenOrderCreatedItem {
  itemId: string | null;
  dishId: string;
  dishName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface KitchenOrderCreatedEvent {
  orderId: string;
  clientId: string;
  status: string;
  type: string;
  createdAt: string;
  totalAmount: number;
  items: KitchenOrderCreatedItem[];
}
