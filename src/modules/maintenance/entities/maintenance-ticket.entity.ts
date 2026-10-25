import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

import { decimalTransformer } from '../../../core/database/decimal.transformer';

export enum MaintenanceTicketType {
  CORRECTIF = 'CORRECTIF',
  PREVENTIF = 'PREVENTIF',
}

export enum MaintenancePriority {
  BASSE = 'BASSE',
  MOYENNE = 'MOYENNE',
  URGENTE = 'URGENTE',
}

export enum MaintenanceTicketStatus {
  OUVERT = 'OUVERT',
  EN_COURS = 'EN_COURS',
  RESOLU = 'RESOLU',
}

@Entity('maintenance_tickets')
export class MaintenanceTicket {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  equipmentId: string;

  @Column()
  reportedByUserId: string;

  @Column({ type: 'text' })
  description: string;

  @Column({
    type: 'enum',
    enum: MaintenanceTicketType,
    default: MaintenanceTicketType.CORRECTIF,
  })
  type: MaintenanceTicketType;

  @Column({
    type: 'enum',
    enum: MaintenancePriority,
    default: MaintenancePriority.MOYENNE,
  })
  priority: MaintenancePriority;

  @Column({
    type: 'enum',
    enum: MaintenanceTicketStatus,
    default: MaintenanceTicketStatus.OUVERT,
  })
  status: MaintenanceTicketStatus;

  @Column({ type: 'timestamp', nullable: true })
  scheduledAt?: Date | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  technician?: string | null;

  @Column({ type: 'text', nullable: true })
  partsReplaced?: string | null;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  cost?: number | null;

  @Column({ type: 'timestamp', nullable: true })
  resolvedAt?: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  /** Indique si le ticket est fermé (résolu). */
  isResolved(): boolean {
    return this.status === MaintenanceTicketStatus.RESOLU;
  }
}
