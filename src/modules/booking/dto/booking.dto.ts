import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

import { BookingResourceType } from '../entities/booking.entity';

/** Création d'une réservation avec vérification anti-conflit côté service. */
export class CreateBookingDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  clientId: string;

  @IsEnum(BookingResourceType)
  resourceType: BookingResourceType;

  @IsUUID(undefined, {
    message: "L'identifiant de ressource doit être un UUID valide",
  })
  resourceId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  practitionerOrCoachId: string;

  @Type(() => Date)
  @IsDate()
  startTime: Date;

  @Type(() => Date)
  @IsDate()
  endTime: Date;
}
