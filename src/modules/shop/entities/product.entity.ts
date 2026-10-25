import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { decimalTransformer } from '../../../core/database/decimal.transformer';

export enum ProductCategory {
  COMPLEMENT = 'COMPLEMENT',
  ACCESSOIRE = 'ACCESSOIRE',
  BOISSON = 'BOISSON',
  AUTRE = 'AUTRE',
}

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenantId', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  /** Référence unique du produit (contrainte portée par la base). */
  @Column({ type: 'varchar', length: 64 })
  sku: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description: string | null;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    transformer: decimalTransformer,
  })
  price: number;

  /** Stock physique restant. Toujours 0 pour un service. */
  @Column({ type: 'int', default: 0 })
  stockQuantity: number;

  @Column({ type: 'enum', enum: ProductCategory })
  category: ProductCategory;

  /** Un service n'a pas de stock et n'est jamais décrémenté. */
  @Column({ type: 'boolean', default: false })
  isService: boolean;

  /** Produit actif : un produit inactif ne peut plus être vendu. */
  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  /** Alias métier de `stockQuantity`, pratique pour les services appelants. */
  get stock(): number {
    return this.stockQuantity;
  }

  set stock(value: number) {
    this.stockQuantity = value;
  }

  /** Vrai si le produit est physique et sous le seuil d'alerte. */
  isLowStock(threshold: number): boolean {
    return !this.isService && this.stockQuantity <= threshold;
  }
}
