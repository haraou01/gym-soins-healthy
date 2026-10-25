import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

import { decimalTransformer } from '../../../core/database/decimal.transformer';
import { Dish } from './dish.entity';
import { Ingredient } from './ingredient.entity';

/** Ligne de recette : quantité d'ingrédient nécessaire pour un plat. */
@Entity('dish_ingredients')
@Unique('uq_dish_ingredients_dish_ingredient', ['dishId', 'ingredientId'])
export class DishIngredient {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  dishId: string;

  @Index()
  @Column({ type: 'uuid' })
  ingredientId: string;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 3,
    transformer: decimalTransformer,
  })
  quantityNeeded: number;

  @ManyToOne(() => Dish, (dish) => dish.ingredients, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'dishId' })
  dish: Dish;

  @ManyToOne(() => Ingredient, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'ingredientId' })
  ingredient: Ingredient;
}
