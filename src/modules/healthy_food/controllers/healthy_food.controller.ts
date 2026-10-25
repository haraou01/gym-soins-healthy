import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';

import {
  AddDishIngredientDto,
  CreateDishDto,
  CreateIngredientDto,
  CreateKitchenOrderDto,
  UpdateDishDto,
  UpdateIngredientDto,
  UpdateOrderStatusDto,
} from '../dto';
import { KitchenOrderStatus } from '../entities';
import { HealthyFoodService } from '../services/healthy_food.service';

@Controller('api/v1/healthy-food')
export class HealthyFoodController {
  constructor(private readonly healthyFoodService: HealthyFoodService) {}

  /** --- Ingrédients --- */

  @Get('ingredients')
  async findAllIngredients() {
    return this.healthyFoodService.findAllIngredients();
  }

  /** Ingrédients sous le seuil d'alerte (déclaré avant :id). */
  @Get('ingredients/low-stock')
  async findLowStockIngredients() {
    return this.healthyFoodService.findLowStockIngredients();
  }

  @Post('ingredients')
  async createIngredient(@Body() dto: CreateIngredientDto) {
    return this.healthyFoodService.createIngredient(dto);
  }

  @Get('ingredients/:id')
  async findIngredientById(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.healthyFoodService.findIngredientById(id);
  }

  @Patch('ingredients/:id')
  async updateIngredient(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateIngredientDto,
  ) {
    return this.healthyFoodService.updateIngredient(id, dto);
  }

  @Delete('ingredients/:id')
  async removeIngredient(@Param('id', new ParseUUIDPipe()) id: string) {
    await this.healthyFoodService.removeIngredient(id);
    return { deleted: true, id };
  }

  /** --- Plats & recettes --- */

  @Get('dishes')
  async findAllDishes() {
    return this.healthyFoodService.findAllDishes();
  }

  @Post('dishes')
  async createDish(@Body() dto: CreateDishDto) {
    return this.healthyFoodService.createDish(dto);
  }

  @Get('dishes/:dishId/ingredients')
  async findDishIngredients(
    @Param('dishId', new ParseUUIDPipe()) dishId: string,
  ) {
    return this.healthyFoodService.findDishIngredients(dishId);
  }

  @Post('dishes/:dishId/ingredients')
  async addIngredientToDish(
    @Param('dishId', new ParseUUIDPipe()) dishId: string,
    @Body() dto: AddDishIngredientDto,
  ) {
    return this.healthyFoodService.addIngredientToDish(dishId, dto);
  }

  @Delete('dishes/:dishId/ingredients/:ingredientId')
  async removeIngredientFromDish(
    @Param('dishId', new ParseUUIDPipe()) dishId: string,
    @Param('ingredientId', new ParseUUIDPipe()) ingredientId: string,
  ) {
    await this.healthyFoodService.removeIngredientFromDish(dishId, ingredientId);
    return { deleted: true, dishId, ingredientId };
  }

  @Get('dishes/:id')
  async findDishById(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.healthyFoodService.findDishById(id);
  }

  @Patch('dishes/:id')
  async updateDish(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateDishDto,
  ) {
    return this.healthyFoodService.updateDish(id, dto);
  }

  @Delete('dishes/:id')
  async removeDish(@Param('id', new ParseUUIDPipe()) id: string) {
    await this.healthyFoodService.removeDish(id);
    return { deleted: true, id };
  }

  /** --- Commandes cuisine (KDS) --- */

  /** Historique / file KDS, filtrable par statut (?status=EN_ATTENTE). */
  @Get('orders')
  async findAllOrders(@Query('status') status?: string) {
    return this.healthyFoodService.findAllOrders(
      status as KitchenOrderStatus | undefined,
    );
  }

  @Get('orders/client/:clientId')
  async findOrdersByClient(@Param('clientId') clientId: string) {
    return this.healthyFoodService.findOrdersByClient(clientId);
  }

  /** Créer une commande : contrôle et décrémentation des stocks d'ingrédients. */
  @Post('orders')
  async createKitchenOrder(
    @Body() dto: CreateKitchenOrderDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.healthyFoodService.createKitchenOrder(dto, idempotencyKey);
  }

  /** Mettre à jour le statut de préparation (transitions contrôlées). */
  @Put('orders/:id/status')
  async updateOrderStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.healthyFoodService.updateOrderStatus(id, dto);
  }
}
