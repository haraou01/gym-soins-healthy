import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { decimalTransformer } from '../../../core/database/decimal.transformer';

export enum IngredientUnit {
  GRAMMES = 'GRAMMES',
  UNITE = 'UNITE',
  ML = 'ML',
}

@Entity('ingredients')
export class Ingredient {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenantId', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'enum', enum: IngredientUnit })
  unit: IngredientUnit;

  /** Stock disponible dans l'unité de l'ingrédient (précision au millième). */
  @Column({
    type: 'decimal',
    precision: 12,
    scale: 3,
    transformer: decimalTransformer,
  })
  stockQuantity: number;

  /** Seuil en-dessous duquel une alerte de réapprovisionnement est levée. */
  @Column({
    type: 'decimal',
    precision: 12,
    scale: 3,
    default: 0,
    transformer: decimalTransformer,
  })
  alertThreshold: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  /** Vrai lorsque le stock atteint ou passe sous le seuil d'alerte. */
  isLowStock(): boolean {
    return this.stockQuantity <= this.alertThreshold;
  }
}
