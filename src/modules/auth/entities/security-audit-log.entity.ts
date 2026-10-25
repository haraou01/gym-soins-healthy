import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('security_audit_logs')
export class SecurityAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  action: string;

  @Index()
  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  /** Référence libre : aucune FK dure vers les modules métier. */
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ type: 'boolean' })
  success: boolean;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  userAgent: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;
}
