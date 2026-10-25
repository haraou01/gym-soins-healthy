import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import {
  EquipmentCategory,
  EquipmentStatus,
} from '../entities/equipment.entity';
import {
  MaintenancePriority,
  MaintenanceTicketStatus,
} from '../entities/maintenance-ticket.entity';

/** Création d'un équipement dans l'inventaire. */
export class CreateEquipmentDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  serialNumber: string;

  @IsEnum(EquipmentCategory)
  category: EquipmentCategory;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  location: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  purchaseDate?: Date;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  supplier?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  warrantyEndDate?: Date;

  @IsOptional()
  @IsInt()
  @Min(0)
  usageCount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  runningHours?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  preventiveIntervalDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  preventiveUsageThreshold?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  preventiveRunningHoursThreshold?: number;
}

/** Mise à jour partielle d'un équipement. */
export class UpdateEquipmentDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  serialNumber?: string;

  @IsOptional()
  @IsEnum(EquipmentCategory)
  category?: EquipmentCategory;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  supplier?: string;

  @IsOptional()
  @IsEnum(EquipmentStatus)
  status?: EquipmentStatus;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  purchaseDate?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  warrantyEndDate?: Date;

  @IsOptional()
  @IsInt()
  @Min(0)
  usageCount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  runningHours?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  preventiveIntervalDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  preventiveUsageThreshold?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  preventiveRunningHoursThreshold?: number;
}

/** Signalement d'une panne / d'un incident correctif. */
export class ReportIncidentDto {
  @IsUUID()
  equipmentId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  reportedByUserId: string;

  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  description: string;

  @IsOptional()
  @IsEnum(MaintenancePriority)
  priority?: MaintenancePriority;
}

/** Planification d'une maintenance préventive. */
export class SchedulePreventiveDto {
  @IsUUID()
  equipmentId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  reportedByUserId: string;

  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  description: string;

  @IsOptional()
  @IsEnum(MaintenancePriority)
  priority?: MaintenancePriority;

  @Type(() => Date)
  @IsDate()
  scheduledAt: Date;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  technician?: string;
}

/** Mise à jour du suivi d'une intervention. */
export class UpdateTicketDto {
  @IsOptional()
  @IsEnum(MaintenanceTicketStatus)
  status?: MaintenanceTicketStatus;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  cost?: number;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  resolvedAt?: Date;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  technician?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  partsReplaced?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  scheduledAt?: Date;
}

/** Enregistrement d'un cycle d'utilisation d'un équipement. */
export class RecordEquipmentUsageDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  usageIncrement?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  runningHoursIncrement?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  reportedByUserId?: string;
}
