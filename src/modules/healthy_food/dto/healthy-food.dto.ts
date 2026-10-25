import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import { DishCategory, DishType } from '../entities/dish.entity';
import { IngredientUnit } from '../entities/ingredient.entity';
import {
  KitchenOrderStatus,
  KitchenOrderType,
} from '../entities/kitchen-order.entity';

const MAX_PRICE = 99_999_999.99;
const MAX_QUANTITY = 999_999_999.999;

/** --- Ingrédients --- */

export class CreateIngredientDto {
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  @Matches(/\S/, { message: "Le nom de l'ingrédient ne peut pas être vide" })
  name: string;

  @IsEnum(IngredientUnit)
  unit: IngredientUnit;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(MAX_QUANTITY)
  stockQuantity: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(MAX_QUANTITY)
  alertThreshold?: number;
}

export class UpdateIngredientDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  @Matches(/\S/, { message: "Le nom de l'ingrédient ne peut pas être vide" })
  name?: string;

  @IsOptional()
  @IsEnum(IngredientUnit)
  unit?: IngredientUnit;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(MAX_QUANTITY)
  stockQuantity?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(MAX_QUANTITY)
  alertThreshold?: number;
}

/** --- Plats --- */

export class CreateDishDto {
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  @Matches(/\S/, { message: 'Le nom du plat ne peut pas être vide' })
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_PRICE)
  price: number;

  @IsOptional()
  @IsBoolean()
  isCustomizable?: boolean;

  @IsOptional()
  @IsEnum(DishCategory)
  category?: DishCategory;

  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;

  @IsEnum(DishType)
  type: DishType;
}

export class UpdateDishDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  @Matches(/\S/, { message: 'Le nom du plat ne peut pas être vide' })
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_PRICE)
  price?: number;

  @IsOptional()
  @IsBoolean()
  isCustomizable?: boolean;

  @IsOptional()
  @IsEnum(DishCategory)
  category?: DishCategory;

  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;

  @IsOptional()
  @IsEnum(DishType)
  type?: DishType;
}

/** --- Recette plat / ingrédient --- */

export class AddDishIngredientDto {
  @IsUUID()
  ingredientId: string;

  /** Quantité nécessaire dans l'unité de l'ingrédient. */
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(MAX_QUANTITY)
  quantityNeeded: number;
}

/** --- Commandes cuisine (KDS) --- */

export class KitchenOrderItemDto {
  @IsUUID()
  dishId: string;

  @IsInt()
  @Min(1)
  @Max(1_000)
  quantity: number;
}

export class CreateKitchenOrderDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Matches(/\S/, { message: 'clientId ne peut pas être vide' })
  clientId: string;

  @IsEnum(KitchenOrderType)
  type: KitchenOrderType;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => KitchenOrderItemDto)
  items: KitchenOrderItemDto[];
}

export class UpdateOrderStatusDto {
  @IsEnum(KitchenOrderStatus)
  status: KitchenOrderStatus;
}
