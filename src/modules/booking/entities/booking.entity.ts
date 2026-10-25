import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum BookingResourceType {
  GYM_CLASS = 'GYM_CLASS',
  CARE_SESSION = 'CARE_SESSION',
  EQUIPMENT = 'EQUIPMENT',
}

export enum BookingStatus {
  CONFIRME = 'CONFIRME',
  ANNULE = 'ANNULE',
  TERMINE = 'TERMINE',
}

@Entity('bookings')
export class Booking {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  clientId: string;

  @Column({ type: 'enum', enum: BookingResourceType })
  resourceType: BookingResourceType;

  @Column()
  resourceId: string;

  @Column()
  practitionerOrCoachId: string;

  @Column({ type: 'timestamp' })
  startTime: Date;

  @Column({ type: 'timestamp' })
  endTime: Date;

  @Column({
    type: 'enum',
    enum: BookingStatus,
    default: BookingStatus.CONFIRME,
  })
  status: BookingStatus;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  /** Indique si le booking est actif (confirmé et non terminé). */
  isActive(): boolean {
    return this.status === BookingStatus.CONFIRME;
  }

  /** Indique si deux créneaux horaires se chevauchent. */
  overlaps(other: {
    startTime: Date;
    endTime: Date;
  }): boolean {
    return (
      this.startTime < other.endTime && this.endTime > other.startTime
    );
  }
}
