import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

import { CareServiceType } from '../entities/care-service.entity';

/** Création d'une prestation du catalogue (soin unitaire ou pack). */
export class CreateCareServiceDto {
  @IsString()
  @MinLength(2)
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsInt()
  @Min(1)
  @Max(600)
  durationMinutes: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price: number;

  @IsEnum(CareServiceType)
  type: CareServiceType;
}

/** Attribution d'un pack de séances à un client. */
export class AssignPackageDto {
  @IsString()
  @MinLength(1)
  clientId: string;

  @IsString()
  @MinLength(1)
  careServiceId: string;

  @IsInt()
  @Min(1)
  @Max(365)
  totalSessions: number;
}

/** Consommation d'une séance sur le pack actif d'un client. */
export class ConsumeSessionDto {
  @IsString()
  @MinLength(1)
  clientId: string;

  @IsString()
  @MinLength(1)
  careServiceId: string;

  @IsString()
  @MinLength(1)
  therapistId: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  timestamp?: Date;

  @IsOptional()
  @IsString()
  notes?: string;
}
