import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum LoyaltyTransactionType {
  GAIN_ACHAT = 'GAIN_ACHAT',
  GAIN_CHECKIN = 'GAIN_CHECKIN',
  RECOMPENSE_UTILISEE = 'RECOMPENSE_UTILISEE',
}

/** Mouvement de points : `points` est signé (+ gain, - dépense). */
@Entity('loyalty_transactions')
export class LoyaltyTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenantId', type: 'uuid' })
  tenantId: string;

  @Index()
  @Column({ type: 'uuid' })
  loyaltyAccountId: string;

  @Column({ type: 'int' })
  points: number;

  @Column({ type: 'enum', enum: LoyaltyTransactionType })
  type: LoyaltyTransactionType;

  @Column({ type: 'varchar', nullable: true })
  description: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
