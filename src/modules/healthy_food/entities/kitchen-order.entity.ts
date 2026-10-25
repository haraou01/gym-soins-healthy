import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum KitchenOrderStatus {
  EN_ATTENTE = 'EN_ATTENTE',
  EN_PREPARATION = 'EN_PREPARATION',
  PRET = 'PRET',
  SERVI = 'SERVI',
  ANNULE = 'ANNULE',
}

export enum KitchenOrderType {
  SUR_PLACE = 'SUR_PLACE',
  A_EMPORTER = 'A_EMPORTER',
}

/** Instantané des plats commandés (nom et prix figés pour le KDS / l'historique). */
export interface KitchenOrderItem {
  /** Identifiant stable de la ligne (généré pour les nouvelles commandes). */
  id?: string;
  dishId: string;
  dishName: string;
  quantity: number;
  unitPrice: number;
  /**
   * Consommation d'ingrédients figée à la création de la commande.
   * Permet de restaurer exactement les stocks en cas d'annulation, même si la
   * recette du plat a changé entre-temps. Absent sur les commandes antérieures.
   */
  ingredients?: KitchenOrderIngredientUse[];
}

/** Quantité d'un ingrédient consommée par une ligne de commande. */
export interface KitchenOrderIngredientUse {
  ingredientId: string;
  quantity: number;
}

/** Transitions autorisées du cycle de vie d'une commande cuisine. */
export const KITCHEN_ORDER_TRANSITIONS: Record<
  KitchenOrderStatus,
  KitchenOrderStatus[]
> = {
  [KitchenOrderStatus.EN_ATTENTE]: [
    KitchenOrderStatus.EN_PREPARATION,
    KitchenOrderStatus.ANNULE,
  ],
  [KitchenOrderStatus.EN_PREPARATION]: [
    KitchenOrderStatus.PRET,
    KitchenOrderStatus.ANNULE,
  ],
  [KitchenOrderStatus.PRET]: [
    KitchenOrderStatus.SERVI,
    KitchenOrderStatus.ANNULE,
  ],
  [KitchenOrderStatus.SERVI]: [],
  [KitchenOrderStatus.ANNULE]: [],
};

@Entity('kitchen_orders')
export class KitchenOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenantId', type: 'uuid' })
  tenantId: string;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  clientId: string;

  @Index()
  @Column({
    type: 'enum',
    enum: KitchenOrderStatus,
    default: KitchenOrderStatus.EN_ATTENTE,
  })
  status: KitchenOrderStatus;

  @Column({ type: 'enum', enum: KitchenOrderType })
  type: KitchenOrderType;

  /** Plats commandés au moment de la création de la commande. */
  @Column({ type: 'jsonb' })
  items: KitchenOrderItem[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  /** Indique si la transition vers `next` est autorisée depuis le statut courant. */
  canTransitionTo(next: KitchenOrderStatus): boolean {
    return KITCHEN_ORDER_TRANSITIONS[this.status].includes(next);
  }
}
