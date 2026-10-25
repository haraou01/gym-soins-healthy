import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { decimalTransformer } from '../../../core/database/decimal.transformer';
import { DishIngredient } from './dish-ingredient.entity';

export enum DishType {
  PRET = 'PRET',
  SUR_COMMANDE = 'SUR_COMMANDE',
}

export enum DishCategory {
  ENTREE = 'ENTREE',
  PLAT = 'PLAT',
  DESSERT = 'DESSERT',
  BOISSON = 'BOISSON',
  SNACK = 'SNACK',
  AUTRE = 'AUTRE',
}

@Entity('dishes')
export class Dish {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description: string | null;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    transformer: decimalTransformer,
  })
  price: number;

  @Column({ type: 'boolean', default: false })
  isCustomizable: boolean;

  @Column({
    type: 'enum',
    enum: DishCategory,
    default: DishCategory.PLAT,
  })
  category: DishCategory;

  /** Un plat indisponible ne peut plus être commandé. */
  @Column({ type: 'boolean', default: true })
  isAvailable: boolean;

  @Column({ type: 'enum', enum: DishType })
  type: DishType;

  @OneToMany(() => DishIngredient, (line) => line.dish, { cascade: true })
  ingredients: DishIngredient[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
