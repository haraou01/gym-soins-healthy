import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, QueryFailedError, Raw, Repository } from 'typeorm';

import {
  KITCHEN_ORDER_CREATED_EVENT,
  KITCHEN_ORDER_STATUS_CHANGED_EVENT,
  type KitchenOrderCreatedEvent,
  type KitchenOrderStatusChangedEvent,
} from '../../../core/events';
import {
  IdempotencyService,
  IDEMPOTENCY_SCOPES,
} from '../../../core/idempotency';
import { OutboxService } from '../../../core/outbox';
import { requireTenantId } from '../../../core/tenant';
import {
  AddDishIngredientDto,
  CreateDishDto,
  CreateIngredientDto,
  CreateKitchenOrderDto,
  UpdateDishDto,
  UpdateIngredientDto,
  UpdateOrderStatusDto,
} from '../dto';
import {
  Dish,
  DishCategory,
  DishIngredient,
  Ingredient,
  KitchenOrder,
  KitchenOrderItem,
  KitchenOrderStatus,
} from '../entities';

const QUANTITY_SCALE = 1000;

@Injectable()
export class HealthyFoodService {
  constructor(
    @InjectRepository(Ingredient)
    private readonly ingredientRepository: Repository<Ingredient>,
    @InjectRepository(Dish)
    private readonly dishRepository: Repository<Dish>,
    @InjectRepository(DishIngredient)
    private readonly dishIngredientRepository: Repository<DishIngredient>,
    @InjectRepository(KitchenOrder)
    private readonly kitchenOrderRepository: Repository<KitchenOrder>,
    private readonly dataSource: DataSource,
    private readonly idempotencyService: IdempotencyService,
    private readonly outboxService: OutboxService,
  ) {}

  /** --- Ingrédients : inventaire --- */

  async findAllIngredients(): Promise<Ingredient[]> {
    return this.ingredientRepository.find({
      where: { tenantId: requireTenantId() },
      order: { name: 'ASC' },
    });
  }

  async findIngredientById(id: string): Promise<Ingredient> {
    const ingredient = await this.ingredientRepository.findOne({
      where: { id, tenantId: requireTenantId() },
    });

    if (!ingredient) {
      throw new NotFoundException(`Ingrédient ${id} introuvable`);
    }

    return ingredient;
  }

  /** Ingrédients dont le stock est inférieur ou égal au seuil d'alerte. */
  async findLowStockIngredients(): Promise<Ingredient[]> {
    return this.ingredientRepository
      .createQueryBuilder('ingredient')
      .where('ingredient.tenantId = :tenantId', { tenantId: requireTenantId() })
      .andWhere('ingredient.stockQuantity <= ingredient.alertThreshold')
      .orderBy('ingredient.stockQuantity', 'ASC')
      .addOrderBy('ingredient.name', 'ASC')
      .getMany();
  }

  async createIngredient(dto: CreateIngredientDto): Promise<Ingredient> {
    const tenantId = requireTenantId();
    const name = dto.name.trim();
    await this.ensureIngredientNameAvailable(name, tenantId);

    const ingredient = this.ingredientRepository.create({
      tenantId,
      name,
      unit: dto.unit,
      stockQuantity: this.roundQuantity(dto.stockQuantity),
      alertThreshold: this.roundQuantity(dto.alertThreshold ?? 0),
    });

    return this.persistIngredient(ingredient);
  }

  async updateIngredient(
    id: string,
    dto: UpdateIngredientDto,
  ): Promise<Ingredient> {
    const ingredient = await this.findIngredientById(id);

    if (dto.name !== undefined) {
      const name = dto.name.trim();

      if (name.toLowerCase() !== ingredient.name.toLowerCase()) {
        await this.ensureIngredientNameAvailable(name, ingredient.tenantId, id);
      }

      ingredient.name = name;
    }

    if (dto.unit !== undefined) {
      ingredient.unit = dto.unit;
    }

    if (dto.stockQuantity !== undefined) {
      ingredient.stockQuantity = this.roundQuantity(dto.stockQuantity);
    }

    if (dto.alertThreshold !== undefined) {
      ingredient.alertThreshold = this.roundQuantity(dto.alertThreshold);
    }

    return this.persistIngredient(ingredient);
  }

  async removeIngredient(id: string): Promise<void> {
    const ingredient = await this.findIngredientById(id);

    const recipesCount = await this.dishIngredientRepository.count({
      where: { ingredientId: id, tenantId: ingredient.tenantId },
    });

    if (recipesCount > 0) {
      throw new ConflictException(
        `Impossible de supprimer « ${ingredient.name} » : utilisé dans ${recipesCount} recette(s)`,
      );
    }

    try {
      await this.ingredientRepository.remove(ingredient);
    } catch (error) {
      if (this.isForeignKeyViolation(error)) {
        throw new ConflictException(
          `Impossible de supprimer « ${ingredient.name} » : il est référencé par une recette`,
        );
      }

      throw error;
    }
  }

  /** --- Plats : catalogue --- */

  async findAllDishes(): Promise<Dish[]> {
    return this.dishRepository.find({
      where: { tenantId: requireTenantId() },
      relations: { ingredients: { ingredient: true } },
      order: { name: 'ASC' },
    });
  }

  async findDishById(id: string): Promise<Dish> {
    const dish = await this.dishRepository.findOne({
      where: { id, tenantId: requireTenantId() },
      relations: { ingredients: { ingredient: true } },
    });

    if (!dish) {
      throw new NotFoundException(`Plat ${id} introuvable`);
    }

    return dish;
  }

  async createDish(dto: CreateDishDto): Promise<Dish> {
    const dish = this.dishRepository.create({
      tenantId: requireTenantId(),
      name: dto.name.trim(),
      description: dto.description?.trim() || null,
      price: this.roundMoney(dto.price),
      isCustomizable: dto.isCustomizable ?? false,
      category: dto.category ?? DishCategory.PLAT,
      isAvailable: dto.isAvailable ?? true,
      type: dto.type,
    });

    return this.dishRepository.save(dish);
  }

  async updateDish(id: string, dto: UpdateDishDto): Promise<Dish> {
    const dish = await this.findDishById(id);

    if (dto.name !== undefined) {
      dish.name = dto.name.trim();
    }

    if (dto.description !== undefined) {
      dish.description = dto.description.trim() || null;
    }

    if (dto.price !== undefined) {
      dish.price = this.roundMoney(dto.price);
    }

    if (dto.isCustomizable !== undefined) {
      dish.isCustomizable = dto.isCustomizable;
    }

    if (dto.category !== undefined) {
      dish.category = dto.category;
    }

    if (dto.isAvailable !== undefined) {
      dish.isAvailable = dto.isAvailable;
    }

    if (dto.type !== undefined) {
      dish.type = dto.type;
    }

    return this.dishRepository.save(dish);
  }

  async removeDish(id: string): Promise<void> {
    const dish = await this.findDishById(id);
    await this.dishRepository.remove(dish);
  }

  /** --- Recettes : liaison plat / ingrédient --- */

  async findDishIngredients(dishId: string): Promise<DishIngredient[]> {
    await this.findDishById(dishId);

    return this.dishIngredientRepository.find({
      where: { dishId, tenantId: requireTenantId() },
      relations: { ingredient: true },
      order: { ingredient: { name: 'ASC' } },
    });
  }

  /** Ajoute un ingrédient à la recette, ou met à jour sa quantité s'il existe déjà. */
  async addIngredientToDish(
    dishId: string,
    dto: AddDishIngredientDto,
  ): Promise<DishIngredient> {
    const dish = await this.findDishById(dishId);
    const ingredient = await this.findIngredientById(dto.ingredientId);
    const quantityNeeded = this.roundQuantity(dto.quantityNeeded);

    let line = await this.dishIngredientRepository.findOne({
      where: {
        dishId: dish.id,
        ingredientId: ingredient.id,
        tenantId: dish.tenantId,
      },
    });

    if (line) {
      line.quantityNeeded = quantityNeeded;
    } else {
      line = this.dishIngredientRepository.create({
        tenantId: dish.tenantId,
        dishId: dish.id,
        ingredientId: ingredient.id,
        quantityNeeded,
      });
    }

    await this.dishIngredientRepository.save(line);

    return this.dishIngredientRepository.findOne({
      where: { id: line.id, tenantId: dish.tenantId },
      relations: { ingredient: true, dish: true },
    });
  }

  async removeIngredientFromDish(
    dishId: string,
    ingredientId: string,
  ): Promise<void> {
    const line = await this.dishIngredientRepository.findOne({
      where: { dishId, ingredientId, tenantId: requireTenantId() },
    });

    if (!line) {
      throw new NotFoundException(
        `L'ingrédient ${ingredientId} ne fait pas partie de la recette du plat ${dishId}`,
      );
    }

    await this.dishIngredientRepository.remove(line);
  }

  /** --- Commandes cuisine (KDS) --- */

  /**
   * Crée une commande de façon atomique :
   * - agrégation des besoins par ingrédient (toutes lignes de recette × quantités) ;
   * - verrou pessimiste sur les ingrédients concernés (triés → pas de deadlock) ;
   * - rupture de stock → BadRequestException et aucune écriture ;
   * - décrémentation des stocks puis enregistrement de la commande.
   */
  async createKitchenOrder(
    dto: CreateKitchenOrderDto,
    idempotencyKey?: string,
  ): Promise<KitchenOrder> {
    const tenantId = requireTenantId();
    const items = dto.items ?? [];

    if (items.length === 0) {
      throw new BadRequestException(
        'Une commande doit contenir au moins un plat',
      );
    }

    this.assertNoDuplicateDishes(items);

    const outcome = await this.dataSource.transaction(async (manager) => {
      return this.idempotencyService.execute(
        manager,
        IDEMPOTENCY_SCOPES.HEALTHY_FOOD_ORDER,
        idempotencyKey,
        this.buildOrderIdempotencyPayload(dto),
        async () => {
          const dishIds = [...new Set(items.map((item) => item.dishId))];
      const dishes = await manager.getRepository(Dish).find({
        where: { id: In(dishIds), tenantId },
        relations: { ingredients: { ingredient: true } },
      });

      const dishesById = new Map(dishes.map((dish) => [dish.id, dish]));
      const missingIds = dishIds.filter((id) => !dishesById.has(id));

      if (missingIds.length > 0) {
        throw new NotFoundException(
          `Plat(s) introuvable(s) : ${missingIds.join(', ')}`,
        );
      }

      const requirements = new Map<string, number>();
      const orderItems: KitchenOrderItem[] = [];

      for (const item of items) {
        const dish = dishesById.get(item.dishId);

        if (!dish) {
          throw new NotFoundException(`Plat ${item.dishId} introuvable`);
        }

        if (!dish.isAvailable) {
          throw new BadRequestException(
            `Le plat « ${dish.name} » n'est pas disponible à la commande`,
          );
        }

        orderItems.push({
          id: randomUUID(),
          dishId: dish.id,
          dishName: dish.name,
          quantity: item.quantity,
          unitPrice: dish.price,
          ingredients: (dish.ingredients ?? []).map((line) => ({
            ingredientId: line.ingredientId,
            quantity: this.roundQuantity(line.quantityNeeded * item.quantity),
          })),
        });

        for (const line of dish.ingredients ?? []) {
          const needed = this.roundQuantity(line.quantityNeeded * item.quantity);
          const current = requirements.get(line.ingredientId) ?? 0;
          requirements.set(
            line.ingredientId,
            this.roundQuantity(current + needed),
          );
        }
      }

      if (requirements.size > 0) {
        const ingredientIds = [...requirements.keys()].sort();

        const lockedIngredients = await manager
          .getRepository(Ingredient)
          .createQueryBuilder('ingredient')
          .setLock('pessimistic_write')
          .where('ingredient.tenantId = :tenantId', { tenantId })
          .andWhere('ingredient.id IN (:...ingredientIds)', { ingredientIds })
          .orderBy('ingredient.id', 'ASC')
          .getMany();

        const ingredientsById = new Map(
          lockedIngredients.map((ingredient) => [ingredient.id, ingredient]),
        );

        const shortages: string[] = [];

        for (const [ingredientId, needed] of requirements) {
          const ingredient = ingredientsById.get(ingredientId);

          if (!ingredient) {
            throw new NotFoundException(
              `Ingrédient ${ingredientId} introuvable`,
            );
          }

          if (ingredient.stockQuantity < needed) {
            shortages.push(
              `${ingredient.name} : ${this.formatQuantity(needed)} ${ingredient.unit} requis, ` +
                `${this.formatQuantity(ingredient.stockQuantity)} disponible(s)`,
            );
          }
        }

        if (shortages.length > 0) {
          throw new BadRequestException(
            `Rupture d'ingrédient — ${shortages.join(' ; ')}`,
          );
        }

        for (const [ingredientId, needed] of requirements) {
          const ingredient = ingredientsById.get(ingredientId);

          if (ingredient) {
            ingredient.stockQuantity = this.roundQuantity(
              Math.max(0, ingredient.stockQuantity - needed),
            );
          }
        }

        await manager.getRepository(Ingredient).save(lockedIngredients);
      }

      const orderRepository = manager.getRepository(KitchenOrder);

      const persistedOrder = await orderRepository.save(
        orderRepository.create({
          tenantId,
          clientId: dto.clientId.trim(),
          status: KitchenOrderStatus.EN_ATTENTE,
          type: dto.type,
          items: orderItems,
        }),
      );

      const outboxEventId = await this.outboxService.append(manager, {
        eventType: KITCHEN_ORDER_CREATED_EVENT,
        aggregateType: 'kitchen_order',
        aggregateId: persistedOrder.id,
        payload: this.buildKitchenOrderCreatedEvent(persistedOrder),
      });

      return { order: persistedOrder, outboxEventId };
        },
      );
    });

    if (!outcome.replayed) {
      // Dispatch immédiat après commit ; le worker reprendra en cas d'échec.
      await this.outboxService
        .dispatchOne(outcome.value.outboxEventId)
        .catch(() => undefined);
    }

    return outcome.value.order;
  }

  private buildOrderIdempotencyPayload(dto: CreateKitchenOrderDto): unknown {
    return {
      clientId: dto.clientId.trim(),
      type: dto.type,
      items: [...dto.items]
        .sort((a, b) => a.dishId.localeCompare(b.dishId))
        .map((item) => ({
          dishId: item.dishId,
          quantity: item.quantity,
        })),
    };
  }

  /**
   * Construit le payload métier de `kitchen.order.created`.
   * L'événement est persisté dans l'outbox de la même transaction.
   */
  private buildKitchenOrderCreatedEvent(
    order: KitchenOrder,
  ): KitchenOrderCreatedEvent {
    return {
      orderId: order.id,
      clientId: order.clientId,
      status: order.status,
      type: order.type,
      createdAt:
        order.createdAt instanceof Date
          ? order.createdAt.toISOString()
          : String(order.createdAt),
      totalAmount: (order.items ?? []).reduce(
        (sum, item) => sum + Number(item.unitPrice) * item.quantity,
        0,
      ),
      items: (order.items ?? []).map((item) => ({
        itemId: item.id ?? null,
        dishId: item.dishId,
        dishName: item.dishName,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        totalPrice: Number(item.unitPrice) * item.quantity,
      })),
    };
  }

  async findAllOrders(status?: KitchenOrderStatus): Promise<KitchenOrder[]> {
    if (
      status !== undefined &&
      !Object.values(KitchenOrderStatus).includes(status)
    ) {
      throw new BadRequestException(`Statut de commande invalide : ${status}`);
    }

    const tenantId = requireTenantId();

    return this.kitchenOrderRepository.find({
      where: status ? { status, tenantId } : { tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOrdersByClient(clientId: string): Promise<KitchenOrder[]> {
    if (!clientId?.trim()) {
      throw new BadRequestException('clientId requis');
    }

    return this.kitchenOrderRepository.find({
      where: {
        clientId: clientId.trim(),
        tenantId: requireTenantId(),
      },
      order: { createdAt: 'DESC' },
    });
  }

  async findOrderById(id: string): Promise<KitchenOrder> {
    const order = await this.kitchenOrderRepository.findOne({
      where: { id, tenantId: requireTenantId() },
    });

    if (!order) {
      throw new NotFoundException(`Commande ${id} introuvable`);
    }

    return order;
  }

  /** Met à jour le statut KDS en respectant les transitions autorisées. */
  async updateOrderStatus(
    id: string,
    dto: UpdateOrderStatusDto,
  ): Promise<KitchenOrder> {
    const order = await this.findOrderById(id);

    if (order.status === dto.status) {
      throw new BadRequestException(
        `La commande est déjà au statut ${dto.status}`,
      );
    }

    if (!order.canTransitionTo(dto.status)) {
      throw new BadRequestException(
        `Transition invalide : ${order.status} → ${dto.status}`,
      );
    }

    // Une annulation rend les ingrédients consommés à la création de la commande.
    // Le changement de statut et l'événement Outbox sont atomiques.
    const previousStatus = order.status;
    const outcome = await this.dataSource.transaction(async (manager) => {
      if (dto.status === KitchenOrderStatus.ANNULE) {
        await this.restoreOrderIngredients(manager, order);
      }

      order.status = dto.status;
      const savedOrder = await manager.getRepository(KitchenOrder).save(order);

      const event: KitchenOrderStatusChangedEvent = {
        orderId: savedOrder.id,
        clientId: savedOrder.clientId,
        previousStatus,
        status: savedOrder.status,
        type: savedOrder.type,
        updatedAt:
          savedOrder.updatedAt instanceof Date
            ? savedOrder.updatedAt.toISOString()
            : String(savedOrder.updatedAt ?? new Date().toISOString()),
      };

      const outboxEventId = await this.outboxService.append(manager, {
        eventType: KITCHEN_ORDER_STATUS_CHANGED_EVENT,
        aggregateType: 'kitchen_order',
        aggregateId: savedOrder.id,
        payload: event,
      });

      return { order: savedOrder, outboxEventId };
    });

    await this.outboxService
      .dispatchOne(outcome.outboxEventId)
      .catch(() => undefined);

    return outcome.order;
  }

  /**
   * Réintègre au stock les ingrédients consommés par une commande annulée.
   * Utilise l'instantané enregistré sur la commande ; à défaut (commandes
   * antérieures), recalcule à partir de la recette courante du plat.
   */
  private async restoreOrderIngredients(
    manager: EntityManager,
    order: KitchenOrder,
  ): Promise<void> {
    const requirements = new Map<string, number>();

    for (const item of order.items ?? []) {
      if (item.ingredients?.length) {
        for (const use of item.ingredients) {
          requirements.set(
            use.ingredientId,
            this.roundQuantity(
              (requirements.get(use.ingredientId) ?? 0) + use.quantity,
            ),
          );
        }
        continue;
      }

      const dish = await manager.getRepository(Dish).findOne({
        where: { id: item.dishId, tenantId: order.tenantId },
        relations: { ingredients: true },
      });

      for (const line of dish?.ingredients ?? []) {
        requirements.set(
          line.ingredientId,
          this.roundQuantity(
            (requirements.get(line.ingredientId) ?? 0) +
              line.quantityNeeded * item.quantity,
          ),
        );
      }
    }

    if (requirements.size === 0) {
      return;
    }

    const ingredientIds = [...requirements.keys()].sort();
    const ingredients = await manager
      .getRepository(Ingredient)
      .createQueryBuilder('ingredient')
      .setLock('pessimistic_write')
      .where('ingredient.tenantId = :tenantId', { tenantId: order.tenantId })
      .andWhere('ingredient.id IN (:...ingredientIds)', { ingredientIds })
      .orderBy('ingredient.id', 'ASC')
      .getMany();

    for (const ingredient of ingredients) {
      const restored = requirements.get(ingredient.id);

      if (restored !== undefined) {
        ingredient.stockQuantity = this.roundQuantity(
          ingredient.stockQuantity + restored,
        );
      }
    }

    await manager.getRepository(Ingredient).save(ingredients);
  }

  /** --- Helpers --- */

  private async ensureIngredientNameAvailable(
    name: string,
    tenantId: string,
    excludedId?: string,
  ): Promise<void> {
    const existing = await this.ingredientRepository.findOne({
      where: {
        tenantId,
        name: Raw((alias) => `LOWER(${alias}) = LOWER(:name)`, { name }),
      },
    });

    if (existing && existing.id !== excludedId) {
      throw new ConflictException(`L'ingrédient « ${name} » existe déjà`);
    }
  }

  private async persistIngredient(ingredient: Ingredient): Promise<Ingredient> {
    try {
      return await this.ingredientRepository.save(ingredient);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(
          `L'ingrédient « ${ingredient.name} » existe déjà`,
        );
      }

      throw error;
    }
  }

  private assertNoDuplicateDishes(items: { dishId: string }[]): void {
    const seen = new Set<string>();

    for (const item of items) {
      if (seen.has(item.dishId)) {
        throw new BadRequestException(
          `Le plat ${item.dishId} est présent plusieurs fois : regroupez les quantités`,
        );
      }

      seen.add(item.dishId);
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    return this.getDriverErrorCode(error) === '23505';
  }

  private isForeignKeyViolation(error: unknown): boolean {
    return this.getDriverErrorCode(error) === '23503';
  }

  private getDriverErrorCode(error: unknown): string | undefined {
    if (!(error instanceof QueryFailedError)) {
      return undefined;
    }

    return (error as QueryFailedError & { driverError?: { code?: string } })
      .driverError?.code;
  }

  private roundQuantity(value: number): number {
    return Math.round(value * QUANTITY_SCALE) / QUANTITY_SCALE;
  }

  private roundMoney(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private formatQuantity(value: number): string {
    return String(Number(value.toFixed(3)));
  }
}
