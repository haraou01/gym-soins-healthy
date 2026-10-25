import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { decimalTransformer } from '../../../core/database/decimal.transformer';
import { SaleItem } from './sale-item.entity';

export enum PaymentMethod {
  ESPECES = 'ESPECES',
  CARTE = 'CARTE',
  POINTS_FIDELITE = 'POINTS_FIDELITE',
}

export enum SaleStatus {
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

@Entity('sales')
export class Sale {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenantId', type: 'uuid' })
  tenantId: string;

  /** Client facultatif : une vente peut être anonyme (client de passage). */
  @Index()
  @Column({ type: 'varchar', length: 64, nullable: true })
  clientId: string | null;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    transformer: decimalTransformer,
  })
  totalAmount: number;

  @Column({ type: 'enum', enum: PaymentMethod })
  paymentMethod: PaymentMethod;

  @Column({
    type: 'enum',
    enum: SaleStatus,
    default: SaleStatus.COMPLETED,
  })
  status: SaleStatus;

  @OneToMany(() => SaleItem, (item) => item.sale, { cascade: true })
  items: SaleItem[];

  @CreateDateColumn()
  createdAt: Date;
}
