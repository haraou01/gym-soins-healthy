import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { HealthyFoodController } from './controllers/healthy_food.controller';
import {
  Dish,
  DishIngredient,
  Ingredient,
  KitchenOrder,
} from './entities';
import { HealthyFoodService } from './services/healthy_food.service';

@Module({
  imports: [TypeOrmModule.forFeature([Ingredient, Dish, DishIngredient, KitchenOrder])],
  controllers: [HealthyFoodController],
  providers: [HealthyFoodService],
  exports: [HealthyFoodService],
})
export class HealthyFoodModule {}
