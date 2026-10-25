import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ClientCarePackageStatus {
  ACTIF = 'ACTIF',
  EPUISE = 'EPUISE',
  EXPIRE = 'EXPIRE',
}

@Entity('client_care_packages')
export class ClientCarePackage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  clientId: string;

  @Column()
  careServiceId: string;

  @Column({ type: 'int' })
  totalSessions: number;

  @Column({ type: 'int' })
  remainingSessions: number;

  @Column({
    type: 'enum',
    enum: ClientCarePackageStatus,
    default: ClientCarePackageStatus.ACTIF,
  })
  status: ClientCarePackageStatus;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  /** Vérifie que le pack est utilisable (actif et avec solde disponible). */
  isUsable(): boolean {
    return this.status === ClientCarePackageStatus.ACTIF && this.remainingSessions > 0;
  }

  /** Décrémente le solde d'une séance et met à jour le statut si épuisé. */
  consumeOneSession(): void {
    if (!this.isUsable()) {
      throw new Error(`Le pack ${this.id} n'est pas utilisable (épuisé ou expiré).`);
    }

    this.remainingSessions -= 1;

    if (this.remainingSessions <= 0) {
      this.status = ClientCarePackageStatus.EPUISE;
    }
  }
}
