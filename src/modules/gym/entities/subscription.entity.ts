import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum SubscriptionType {
  PASS_JOURNALIER = 'PASS_JOURNALIER',
  MENSUEL = 'MENSUEL',
  ANNUEL = 'ANNUEL',
  CARNET_SEANCES = 'CARNET_SEANCES',
}

export enum SubscriptionStatus {
  ACTIF = 'ACTIF',
  SUSPENDU = 'SUSPENDU',
  EXPIRE = 'EXPIRE',
}

@Entity('subscriptions')
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  clientId: string;

  @Column({ type: 'enum', enum: SubscriptionType })
  type: SubscriptionType;

  @Column({
    type: 'enum',
    enum: SubscriptionStatus,
    default: SubscriptionStatus.ACTIF,
  })
  status: SubscriptionStatus;

  @Column({ type: 'timestamp' })
  startDate: Date;

  @Column({ type: 'timestamp' })
  endDate: Date;

  @Column({ type: 'int', default: 0 })
  remainingSessions: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  /** Vérifie que l'abonnement est actif ET dans sa fenêtre de validité temporelle. */
  isActive(): boolean {
    if (this.status !== SubscriptionStatus.ACTIF) {
      return false;
    }

    const now = new Date();
    return now >= this.startDate && now <= this.endDate;
  }

  /** Vérifie qu'il reste des séances disponibles (uniquement pour les carnets). */
  hasSessionsAvailable(): boolean {
    if (this.type === SubscriptionType.CARNET_SEANCES) {
      return this.remainingSessions > 0;
    }

    return true;
  }
}
