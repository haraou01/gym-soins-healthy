import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { HealthyFoodController } from './controllers/healthy_food.controller';
import { KdsSseController } from './controllers/kds-sse.controller';
import {
  Dish,
  DishIngredient,
  Ingredient,
  KdsStreamTicket,
  KitchenOrder,
} from './entities';
import { HealthyFoodService } from './services/healthy_food.service';
import { KdsEventsService } from './services/kds-events.service';
import { KdsStreamTicketService } from './services/kds-stream-ticket.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Ingredient,
      Dish,
      DishIngredient,
      KitchenOrder,
      KdsStreamTicket,
    ]),
  ],
  controllers: [HealthyFoodController, KdsSseController],
  providers: [
    HealthyFoodService,
    KdsStreamTicketService,
    KdsEventsService,
  ],
  exports: [HealthyFoodService],
})
export class HealthyFoodModule {}
