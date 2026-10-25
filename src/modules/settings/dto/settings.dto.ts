import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const CURRENCY_CODE = /^[A-Z]{3}$/;
const LOCALE_CODE = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

export class TaxRateDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  id?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  @Matches(/\S/, { message: 'Le libellé du taux ne peut pas être vide' })
  label: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  rate: number;
}

export class CancellationPolicyDto {
  @IsNumber({ maxDecimalPlaces: 0 })
  @Min(0)
  @Max(8760)
  freeCancellationHours: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  lateCancellationFeePercent: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  noShowFeePercent: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

/**
 * Mise à jour de la configuration (partielle : seuls les champs fournis
 * sont appliqués).
 */
export class UpdateSettingsDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  @Matches(/\S/, { message: "Le nom de l'établissement ne peut pas être vide" })
  gymName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  logoUrl?: string;

  @IsOptional()
  @IsString()
  @Matches(HEX_COLOR, {
    message: 'primaryColor doit être une couleur hexadécimale (#RRGGBB)',
  })
  primaryColor?: string;

  @IsOptional()
  @IsString()
  @Matches(HEX_COLOR, {
    message: 'secondaryColor doit être une couleur hexadécimale (#RRGGBB)',
  })
  secondaryColor?: string;

  @IsOptional()
  @IsString()
  @Matches(CURRENCY_CODE, {
    message: 'currency doit être un code ISO 4217 (ex. EUR, USD)',
  })
  currency?: string;

  @IsOptional()
  @IsString()
  @Matches(LOCALE_CODE, {
    message: 'locale doit être un code de langue valide (ex. fr, en, fr-FR)',
  })
  locale?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => TaxRateDto)
  taxRates?: TaxRateDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => CancellationPolicyDto)
  cancellationPolicy?: CancellationPolicyDto;
}
