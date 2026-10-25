import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum EquipmentCategory {
  CARDIO = 'CARDIO',
  MUSCULATION = 'MUSCULATION',
  FUNCTIONAL = 'FUNCTIONAL',
  CABINE_SOIN = 'CABINE_SOIN',
  TOURNIQUET = 'TOURNQUIET',
}

export enum EquipmentStatus {
  ACTIF = 'ACTIF',
  EN_PANNE = 'EN_PANNE',
  EN_MAINTENANCE = 'EN_MAINTENANCE',
}

@Entity('equipments')
export class Equipment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  serialNumber: string;

  @Column({ type: 'enum', enum: EquipmentCategory })
  category: EquipmentCategory;

  @Column({ type: 'varchar', length: 200 })
  location: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  supplier?: string;

  @Column({ type: 'date', nullable: true })
  warrantyEndDate?: Date;

  @Column({
    type: 'enum',
    enum: EquipmentStatus,
    default: EquipmentStatus.ACTIF,
  })
  status: EquipmentStatus;

  @Column({ type: 'date', nullable: true })
  purchaseDate?: Date;

  @Column({ type: 'int', default: 0 })
  usageCount: number;

  @Column({ type: 'int', default: 0 })
  runningHours: number;

  /** Intervalle calendaire entre deux maintenances préventives (en jours). */
  @Column({ type: 'int', nullable: true })
  preventiveIntervalDays?: number | null;

  /** Nombre d'utilisations déclenchant une maintenance préventive. */
  @Column({ type: 'int', nullable: true })
  preventiveUsageThreshold?: number | null;

  /** Nombre d'heures de fonctionnement déclenchant une maintenance préventive. */
  @Column({ type: 'int', nullable: true })
  preventiveRunningHoursThreshold?: number | null;

  /** Dernière maintenance préventive terminée. */
  @Column({ type: 'timestamp', nullable: true })
  lastPreventiveAt?: Date | null;

  /** Prochaine échéance calendaire de maintenance préventive. */
  @Column({ type: 'timestamp', nullable: true })
  nextPreventiveAt?: Date | null;

  /** Compteur d'utilisations au moment de la dernière préventive. */
  @Column({ type: 'int', default: 0 })
  usageAtLastPreventive: number;

  /** Compteur d'heures au moment de la dernière préventive. */
  @Column({ type: 'int', default: 0 })
  runningHoursAtLastPreventive: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  /** Indique si l'équipement est disponible à l'usage. */
  isAvailable(): boolean {
    return this.status === EquipmentStatus.ACTIF;
  }

  /** Indique si l'équipement est hors service. */
  isOutOfService(): boolean {
    return this.status !== EquipmentStatus.ACTIF;
  }

  /** Indique si une preventive est due (calendrier ou seuils d'usage). */
  needsPreventive(now = new Date()): boolean {
    if (this.nextPreventiveAt && now >= this.nextPreventiveAt) {
      return true;
    }

    if (
      this.preventiveUsageThreshold !== null &&
      this.preventiveUsageThreshold !== undefined &&
      this.usageCount - this.usageAtLastPreventive >=
        this.preventiveUsageThreshold
    ) {
      return true;
    }

    if (
      this.preventiveRunningHoursThreshold !== null &&
      this.preventiveRunningHoursThreshold !== undefined &&
      this.runningHours - this.runningHoursAtLastPreventive >=
        this.preventiveRunningHoursThreshold
    ) {
      return true;
    }

    return false;
  }

  /** Enregistre une utilisation et/ou des heures de fonctionnement. */
  recordUsage(usageIncrement = 1, runningHoursIncrement = 0): void {
    this.usageCount += usageIncrement;
    this.runningHours += runningHoursIncrement;
  }

  /** Clôture une preventive et calcule la prochaine échéance calendaire. */
  applyPreventiveCompletion(completedAt = new Date()): void {
    this.lastPreventiveAt = completedAt;
    this.usageAtLastPreventive = this.usageCount;
    this.runningHoursAtLastPreventive = this.runningHours;

    this.nextPreventiveAt =
      this.preventiveIntervalDays && this.preventiveIntervalDays > 0
        ? new Date(
            completedAt.getTime() +
              this.preventiveIntervalDays * 24 * 60 * 60 * 1000,
          )
        : null;
  }
}
