import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';

import { CreateProductDto, CreateSaleDto, ProcessSaleDto, UpdateProductDto } from '../dto';
import { PaymentMethod, Product, Sale, SaleItem, SaleStatus } from '../entities';
import {
  SALE_COMPLETED_EVENT,
  type SaleCompletedEvent,
} from '../../../core/events';
import {
  IdempotencyService,
  IDEMPOTENCY_SCOPES,
} from '../../../core/idempotency';
import { OutboxService } from '../../../core/outbox';

/** Seuil par défaut des alertes de stock bas. */
export const DEFAULT_LOW_STOCK_THRESHOLD = 5;

interface SaleLine {
  product: Product;
  quantity: number;
  unitPriceCents: number;
}

export interface SaleReceiptLine {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface SaleReceipt {
  success: true;
  saleId: string;
  clientId: string | null;
  paymentMethod: PaymentMethod;
  status: SaleStatus;
  totalAmount: number;
  createdAt: Date;
  items: SaleReceiptLine[];
}

@Injectable()
export class ShopService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(Sale)
    private readonly saleRepository: Repository<Sale>,
    @InjectRepository(SaleItem)
    private readonly saleItemRepository: Repository<SaleItem>,
    private readonly dataSource: DataSource,
    private readonly idempotencyService: IdempotencyService,
    private readonly outboxService: OutboxService,
  ) {}

  /** --- Catalogue produits (CRUD) --- */

  async findAllProducts(): Promise<Product[]> {
    return this.productRepository.find({
      order: { category: 'ASC', name: 'ASC' },
    });
  }

  async findProductById(id: string): Promise<Product> {
    const product = await this.productRepository.findOne({ where: { id } });

    if (!product) {
      throw new NotFoundException(`Produit ${id} introuvable`);
    }

    return product;
  }

  async createProduct(dto: CreateProductDto): Promise<Product> {
    const sku = this.normalizeSku(dto.sku);
    await this.ensureSkuAvailable(sku);

    const isService = dto.isService ?? false;
    const product = this.productRepository.create({
      name: dto.name.trim(),
      sku,
      description: dto.description?.trim() || null,
      price: this.roundMoney(dto.price),
      stockQuantity: isService ? 0 : dto.stockQuantity ?? 0,
      category: dto.category,
      isService,
      isActive: dto.isActive ?? true,
    });

    return this.persistProduct(product);
  }

  async updateProduct(id: string, dto: UpdateProductDto): Promise<Product> {
    const product = await this.findProductById(id);

    if (dto.sku !== undefined) {
      const sku = this.normalizeSku(dto.sku);

      if (sku !== product.sku) {
        await this.ensureSkuAvailable(sku, id);
        product.sku = sku;
      }
    }

    if (dto.name !== undefined) {
      product.name = dto.name.trim();
    }

    if (dto.description !== undefined) {
      product.description = dto.description.trim() || null;
    }

    if (dto.price !== undefined) {
      product.price = this.roundMoney(dto.price);
    }

    if (dto.category !== undefined) {
      product.category = dto.category;
    }

    if (dto.isService !== undefined) {
      product.isService = dto.isService;

      if (dto.isService) {
        product.stockQuantity = 0;
      }
    }

    if (dto.isActive !== undefined) {
      product.isActive = dto.isActive;
    }

    // Le stock d'un service reste toujours à 0.
    if (dto.stockQuantity !== undefined && !product.isService) {
      product.stockQuantity = dto.stockQuantity;
    }

    return this.persistProduct(product);
  }

  async removeProduct(id: string): Promise<void> {
    const product = await this.findProductById(id);

    const salesCount = await this.saleItemRepository.count({
      where: { productId: id },
    });

    if (salesCount > 0) {
      throw new ConflictException(
        `Impossible de supprimer « ${product.name} » : ${salesCount} ligne(s) de vente y font référence`,
      );
    }

    await this.productRepository.remove(product);
  }

  /** --- Gestion des stocks --- */

  /**
   * Produits physiques dont le stock est inférieur ou égal au seuil.
   * Les services sont exclus (aucune gestion de stock).
   */
  async findLowStockProducts(
    threshold: number = DEFAULT_LOW_STOCK_THRESHOLD,
  ): Promise<Product[]> {
    if (!Number.isInteger(threshold) || threshold < 0) {
      throw new BadRequestException(
        'Le seuil de stock bas doit être un entier positif ou nul',
      );
    }

    return this.productRepository
      .createQueryBuilder('product')
      .where('product.isService = false')
      .andWhere('product.isActive = true')
      .andWhere('product.stockQuantity <= :threshold', { threshold })
      .orderBy('product.stockQuantity', 'ASC')
      .addOrderBy('product.name', 'ASC')
      .getMany();
  }

  /** --- Point de vente (POS) --- */

  /**
   * Valide une vente de façon atomique :
   * - verrou pessimiste sur les produits (triés par id → pas de deadlock) ;
   * - contrôle strict du stock des produits physiques ;
   * - calcul du total en centimes (pas d'erreur d'arrondi flottant) ;
   * - création de la vente + items + décrémentation des stocks dans une seule transaction.
   */
  async createSale(
    dto: CreateSaleDto,
    idempotencyKey?: string,
  ): Promise<Sale> {
    const items = dto.items ?? [];

    if (items.length === 0) {
      throw new BadRequestException(
        'Une vente doit contenir au moins un article',
      );
    }

    this.assertNoDuplicateProducts(items);

    const outcome = await this.dataSource.transaction(async (manager) => {
      return this.idempotencyService.execute(
        manager,
        IDEMPOTENCY_SCOPES.SHOP_SALE,
        idempotencyKey,
        this.buildSaleIdempotencyPayload(dto),
        async () => {
          const productRepository = manager.getRepository(Product);
          const productIds = [...new Set(items.map((item) => item.productId))];

      const products = await productRepository
        .createQueryBuilder('product')
        .setLock('pessimistic_write')
        .where('product.id IN (:...productIds)', { productIds })
        .orderBy('product.id', 'ASC')
        .getMany();

      const productsById = new Map(products.map((product) => [product.id, product]));
      const missingIds = productIds.filter((id) => !productsById.has(id));

      if (missingIds.length > 0) {
        throw new NotFoundException(
          `Produit(s) introuvable(s) : ${missingIds.join(', ')}`,
        );
      }

      const lines: SaleLine[] = [];
      let totalCents = 0;

      for (const item of items) {
        const product = productsById.get(item.productId);

        if (!product) {
          throw new NotFoundException(`Produit ${item.productId} introuvable`);
        }

        if (!product.isActive) {
          throw new BadRequestException(
            `Le produit « ${product.name} » (${product.sku}) est inactif`,
          );
        }

        if (!product.isService && product.stockQuantity < item.quantity) {
          throw new BadRequestException(
            `Stock insuffisant pour « ${product.name} » (${product.sku}) : ` +
              `${product.stockQuantity} disponible(s), ${item.quantity} demandé(s)`,
          );
        }

        const unitPriceCents = Math.round(product.price * 100);
        totalCents += unitPriceCents * item.quantity;

        lines.push({ product, quantity: item.quantity, unitPriceCents });
      }

      const saleRepository = manager.getRepository(Sale);
      const savedSale = await saleRepository.save(
        saleRepository.create({
          clientId: dto.clientId?.trim() || null,
          totalAmount: totalCents / 100,
          paymentMethod: dto.paymentMethod,
          status: SaleStatus.COMPLETED,
        }),
      );

      const saleItemRepository = manager.getRepository(SaleItem);
      await saleItemRepository.save(
        lines.map((line) =>
          saleItemRepository.create({
            saleId: savedSale.id,
            productId: line.product.id,
            quantity: line.quantity,
            unitPrice: line.unitPriceCents / 100,
            totalPrice: (line.unitPriceCents * line.quantity) / 100,
          }),
        ),
      );

      const physicalProducts: Product[] = [];

      for (const line of lines) {
        if (!line.product.isService) {
          line.product.stockQuantity -= line.quantity;
          physicalProducts.push(line.product);
        }
      }

      if (physicalProducts.length > 0) {
        await productRepository.save(physicalProducts);
      }

      const persistedSale =
        (await saleRepository.findOne({
          where: { id: savedSale.id },
          relations: { items: { product: true } },
        })) ?? savedSale;

      const outboxEventId = await this.outboxService.append(manager, {
        eventType: SALE_COMPLETED_EVENT,
        aggregateType: 'sale',
        aggregateId: persistedSale.id,
        payload: this.buildSaleCompletedEvent(persistedSale),
      });

      return { sale: persistedSale, outboxEventId };
        },
      );
    });

    if (!outcome.replayed) {
      // Dispatch immédiat après commit ; le worker reprendra en cas d'échec.
      await this.outboxService
        .dispatchOne(outcome.value.outboxEventId)
        .catch(() => undefined);
    }

    return outcome.value.sale;
  }

  private buildSaleIdempotencyPayload(dto: CreateSaleDto): unknown {
    return {
      clientId: dto.clientId?.trim() || null,
      paymentMethod: dto.paymentMethod,
      items: [...dto.items]
        .sort((a, b) => a.productId.localeCompare(b.productId))
        .map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
        })),
    };
  }

  /**
   * Construit le payload métier de `sale.completed`.
   * L'événement est persisté dans l'outbox de la même transaction que la vente.
   */
  private buildSaleCompletedEvent(sale: Sale): SaleCompletedEvent {
    return {
      saleId: sale.id,
      clientId: sale.clientId,
      totalAmount: Number(sale.totalAmount),
      totalCents: Math.round(Number(sale.totalAmount) * 100),
      paymentMethod: sale.paymentMethod,
      status: sale.status ?? SaleStatus.COMPLETED,
      createdAt:
        sale.createdAt instanceof Date
          ? sale.createdAt.toISOString()
          : String(sale.createdAt),
      items: (sale.items ?? []).map((item) => ({
        productId: item.productId,
        sku: item.product?.sku ?? '',
        name: item.product?.name ?? '',
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        totalPrice: Number(item.totalPrice ?? 0),
      })),
    };
  }

  /**
   * Point d'entrée POS avec ticket/reçu structuré.
   *
   * Réutilise `createSale()` afin de conserver :
   * - le verrou pessimiste ;
   * - le contrôle strict du stock ;
   * - la transaction vente + lignes, puis l'événement optionnel `sale.completed`.
   */
  async processSale(
    dto: ProcessSaleDto,
    idempotencyKey?: string,
  ): Promise<SaleReceipt> {
    const sale = await this.createSale(
      {
        clientId: dto.clientId,
        items: dto.items,
        paymentMethod: dto.paymentMethod ?? PaymentMethod.ESPECES,
      },
      idempotencyKey,
    );

    return this.buildReceipt(sale);
  }

  private buildReceipt(sale: Sale): SaleReceipt {
    const items = (sale.items ?? []).map((item) => {
      const unitPrice = Number(item.unitPrice);
      const totalPrice = Number(
        item.totalPrice ?? unitPrice * item.quantity,
      );

      return {
        productId: item.productId,
        sku: item.product?.sku ?? '',
        name: item.product?.name ?? '',
        quantity: item.quantity,
        unitPrice,
        totalPrice,
      };
    });

    return {
      success: true,
      saleId: sale.id,
      clientId: sale.clientId,
      paymentMethod: sale.paymentMethod,
      status: sale.status ?? SaleStatus.COMPLETED,
      totalAmount: Number(sale.totalAmount),
      createdAt: sale.createdAt,
      items,
    };
  }

  async findAllSales(): Promise<Sale[]> {
    return this.saleRepository.find({
      relations: { items: { product: true } },
      order: { createdAt: 'DESC' },
    });
  }

  async findSalesByClient(clientId: string): Promise<Sale[]> {
    return this.saleRepository.find({
      where: { clientId },
      relations: { items: { product: true } },
      order: { createdAt: 'DESC' },
    });
  }

  /** --- Helpers --- */

  private async ensureSkuAvailable(sku: string, excludedId?: string): Promise<void> {
    const existing = await this.productRepository.findOne({ where: { sku } });

    if (existing && existing.id !== excludedId) {
      throw new ConflictException(`Le SKU « ${sku} » est déjà utilisé`);
    }
  }

  private async persistProduct(product: Product): Promise<Product> {
    try {
      return await this.productRepository.save(product);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(`Le SKU « ${product.sku} » est déjà utilisé`);
      }

      throw error;
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }

    const driverError = (error as QueryFailedError & {
      driverError?: { code?: string };
    }).driverError;

    return driverError?.code === '23505';
  }

  private assertNoDuplicateProducts(items: { productId: string }[]): void {
    const seen = new Set<string>();

    for (const item of items) {
      if (seen.has(item.productId)) {
        throw new BadRequestException(
          `Le produit ${item.productId} est présent plusieurs fois : regroupez les quantités`,
        );
      }

      seen.add(item.productId);
    }
  }

  private normalizeSku(sku: string): string {
    return sku.trim();
  }

  private roundMoney(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
