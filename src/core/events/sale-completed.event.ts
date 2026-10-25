/**
 * Événements métier transverses.
 *
 * Ce fichier ne dépend d'aucun module métier : il définit uniquement le
 * contrat d'événement partagé par les producteurs (Shop) et les consommateurs
 * optionnels (Loyalty, futurs modules analytiques, etc.).
 */

export const SALE_COMPLETED_EVENT = 'sale.completed';

export interface SaleCompletedItem {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface SaleCompletedEvent {
  saleId: string;
  clientId: string | null;
  totalAmount: number;
  totalCents: number;
  paymentMethod: string;
  status: string;
  createdAt: string;
  items: SaleCompletedItem[];
  /** Identifiant de l'événement Outbox, ajouté au moment du dispatch. */
  outboxEventId?: string;
}
