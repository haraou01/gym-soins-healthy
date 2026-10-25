import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { CreateProductDto, CreateSaleDto, ProcessSaleDto, UpdateProductDto } from '../dto';
import { ShopService } from '../services/shop.service';

@Controller('api/v1/shop')
export class ShopController {
  constructor(private readonly shopService: ShopService) {}

  /** --- Catalogue --- */

  /** Liste de tous les produits (physiques et services). */
  @Get()
  async findAllProducts() {
    return this.shopService.findAllProducts();
  }

  /** Produits physiques en alerte de stock bas (?threshold=). */
  @Get('stock/low')
  async findLowStockProducts(@Query('threshold') threshold?: string) {
    if (threshold === undefined) {
      return this.shopService.findLowStockProducts();
    }

    const parsed = Number(threshold);

    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new BadRequestException(
        'Le paramètre threshold doit être un entier positif ou nul',
      );
    }

    return this.shopService.findLowStockProducts(parsed);
  }

  /** Créer un produit ou un service. */
  @Post()
  async createProduct(@Body() dto: CreateProductDto) {
    return this.shopService.createProduct(dto);
  }

  /** --- Ventes (POS) --- */

  /** Historique complet des ventes avec leurs lignes. */
  @Get('sales')
  async findAllSales() {
    return this.shopService.findAllSales();
  }

  /** Ventes d'un client donné. */
  @Get('sales/client/:clientId')
  async findSalesByClient(@Param('clientId') clientId: string) {
    return this.shopService.findSalesByClient(clientId);
  }

  /** Valider une vente : contrôle du stock + décrémentation transactionnelle. */
  @Post('sales')
  async createSale(
    @Body() dto: CreateSaleDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.shopService.createSale(dto, idempotencyKey);
  }

  /** Valider une vente POS et retourner un ticket/reçu structuré. */
  @Post('sales/process')
  async processSale(
    @Body() dto: ProcessSaleDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.shopService.processSale(dto, idempotencyKey);
  }

  /** --- Produit unitaire --- */

  @Get(':id')
  async findProductById(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.shopService.findProductById(id);
  }

  @Patch(':id')
  async updateProduct(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.shopService.updateProduct(id, dto);
  }

  @Delete(':id')
  async removeProduct(@Param('id', new ParseUUIDPipe()) id: string) {
    await this.shopService.removeProduct(id);
    return { deleted: true, id };
  }
}
