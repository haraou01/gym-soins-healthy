import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Compte de fidélité d'un client (1 compte par client). */
@Entity('loyalty_accounts')
export class LoyaltyAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenantId', type: 'uuid' })
  tenantId: string;

  /** Identifiant métier du client (référence externe au module clients). */
  @Column({ type: 'varchar' })
  clientId: string;

  /** Email facultatif, permet la recherche d'un compte par email. */
  @Index()
  @Column({ type: 'varchar', nullable: true })
  clientEmail: string | null;

  /** Solde courant de points (jamais négatif). */
  @Column({ type: 'int', default: 0 })
  pointsBalance: number;

  /** Total cumulé de points gagnés. */
  @Column({ type: 'int', default: 0 })
  totalEarned: number;

  /** Total cumulé de points dépensés. */
  @Column({ type: 'int', default: 0 })
  totalSpent: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
