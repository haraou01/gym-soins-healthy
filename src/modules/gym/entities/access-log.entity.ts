import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

export enum AccessDirection {
  ENTREE = 'ENTREE',
  SORTIE = 'SORTIE',
}

export enum AccessMethod {
  RFID = 'RFID',
  QR_CODE = 'QR_CODE',
  BIOMETRIE = 'BIOMETRIE',
  MANUEL = 'MANUEL',
}

@Entity('access_logs')
export class AccessLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenantId', type: 'uuid' })
  tenantId: string;

  @Column()
  clientId: string;

  @Column({ type: 'enum', enum: AccessDirection })
  direction: AccessDirection;

  @Column({ type: 'timestamp' })
  timestamp: Date;

  @Column({ type: 'enum', enum: AccessMethod })
  method: AccessMethod;

  @Column({ type: 'boolean', default: false })
  granted: boolean;

  @Column({ type: 'text', nullable: true })
  reason?: string;

  @CreateDateColumn()
  createdAt: Date;
}
