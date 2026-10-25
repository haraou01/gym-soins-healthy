import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ShopController } from './controllers/shop.controller';
import { Product, Sale, SaleItem } from './entities';
import { ShopService } from './services/shop.service';

@Module({
  imports: [TypeOrmModule.forFeature([Product, Sale, SaleItem])],
  controllers: [ShopController],
  providers: [ShopService],
  exports: [ShopService],
})
export class ShopModule {}
