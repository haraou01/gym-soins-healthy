import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';

@Entity('care_sessions')
export class CareSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  clientId: string;

  @Column()
  careServiceId: string;

  @Column()
  therapistId: string;

  @Column({ type: 'timestamp' })
  timestamp: Date;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  /** Pack de soins effectivement consommé (traçabilité et audit). */
  @Column({ type: 'uuid', nullable: true })
  packageId?: string;

  @CreateDateColumn()
  createdAt: Date;
}
