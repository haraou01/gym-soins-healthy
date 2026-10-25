import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

import { AccessMethod } from '../entities/access-log.entity';
import { SubscriptionStatus, SubscriptionType } from '../entities/subscription.entity';

export class CheckInDto {
  @IsString()
  @MinLength(1)
  clientId: string;

  @IsEnum(AccessMethod)
  method: AccessMethod;
}

export class CheckOutDto {
  @IsString()
  @MinLength(1)
  clientId: string;

  @IsEnum(AccessMethod)
  method: AccessMethod;
}

export class CreateSubscriptionDto {
  @IsString()
  @MinLength(1)
  clientId: string;

  @IsEnum(SubscriptionType)
  type: SubscriptionType;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  remainingSessions?: number;
}

export class UpdateSubscriptionDto {
  @IsEnum(SubscriptionStatus)
  status: SubscriptionStatus;
}
