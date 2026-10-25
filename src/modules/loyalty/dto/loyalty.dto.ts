import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

import { LoyaltyTransactionType } from '../entities/loyalty-transaction.entity';

/** Corps commun aux opérations de crédit et de débit de points. */
export class LoyaltyMovementDto {
  @IsString()
  @MinLength(1)
  clientId: string;

  @IsOptional()
  @IsEmail()
  clientEmail?: string;

  @IsInt()
  @Min(1)
  points: number;

  @IsOptional()
  @IsEnum(LoyaltyTransactionType)
  type?: LoyaltyTransactionType;

  @IsOptional()
  @IsString()
  description?: string;
}
