import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, FindOptionsWhere, Repository } from 'typeorm';

import {
  LoyaltyAccount,
  LoyaltyTransaction,
  LoyaltyTransactionType,
} from '../entities';
import { requireTenantId } from '../../../core/tenant';

export interface LoyaltyMovementInput {
  clientId: string;
  clientEmail?: string;
  points: number;
  type?: LoyaltyTransactionType;
  description?: string;
}

export interface LoyaltyBalance {
  id: string;
  clientId: string;
  clientEmail: string | null;
  pointsBalance: number;
  totalEarned: number;
  totalSpent: number;
}

export interface LoyaltyMovementResult {
  account: LoyaltyBalance;
  transaction: LoyaltyTransaction;
}

type MovementDirection = 'credit' | 'debit';

interface NormalizedMovement {
  clientId: string;
  email: string | null;
  points: number;
  type: LoyaltyTransactionType;
  description: string | null;
}

@Injectable()
export class LoyaltyService {
  constructor(
    @InjectRepository(LoyaltyAccount)
    private readonly accountRepository: Repository<LoyaltyAccount>,
    @InjectRepository(LoyaltyTransaction)
    private readonly transactionRepository: Repository<LoyaltyTransaction>,
    private readonly dataSource: DataSource,
  ) {}

  /** --- Consultation --- */

  async findAllAccounts(): Promise<LoyaltyAccount[]> {
    return this.accountRepository.find({
      where: { tenantId: requireTenantId() },
      order: { createdAt: 'DESC' },
    });
  }

  async getBalance(identifier: string): Promise<LoyaltyBalance> {
    const account = await this.requireAccount(identifier);
    return this.toBalance(account);
  }

  async getTransactions(identifier: string): Promise<LoyaltyTransaction[]> {
    const account = await this.requireAccount(identifier);

    return this.transactionRepository.find({
      where: { loyaltyAccountId: account.id, tenantId: account.tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  /** --- Crédit / Débit --- */

  /**
   * Crédite des points. `manager` permet de participer à une transaction
   * existante (ex: vente boutique + fidélité atomiques).
   */
  async credit(
    input: LoyaltyMovementInput,
    manager?: EntityManager,
  ): Promise<LoyaltyMovementResult> {
    return this.applyMovement('credit', input, manager);
  }

  async debit(
    input: LoyaltyMovementInput,
    manager?: EntityManager,
  ): Promise<LoyaltyMovementResult> {
    return this.applyMovement('debit', input, manager);
  }

  /**
   * Applique un mouvement de points de façon atomique :
   * verrou pessimiste sur le compte pour éviter tout solde négatif en concurrence.
   */
  private async applyMovement(
    direction: MovementDirection,
    input: LoyaltyMovementInput,
    manager?: EntityManager,
  ): Promise<LoyaltyMovementResult> {
    const tenantId = requireTenantId();
    const movement: NormalizedMovement = {
      clientId: input.clientId,
      email: input.clientEmail?.trim().toLowerCase() || null,
      points: this.normalizePoints(input.points),
      type:
        input.type ??
        (direction === 'credit'
          ? LoyaltyTransactionType.GAIN_ACHAT
          : LoyaltyTransactionType.RECOMPENSE_UTILISEE),
      description: input.description?.trim() || null,
    };

    if (manager) {
      return this.runMovement(manager, direction, movement);
    }

    return this.dataSource.transaction((transactionManager) =>
      this.runMovement(transactionManager, direction, movement),
    );
  }

  private async runMovement(
    manager: EntityManager,
    direction: MovementDirection,
    movement: NormalizedMovement,
  ): Promise<LoyaltyMovementResult> {
    const account = await this.lockAccount(
      manager,
      movement.clientId,
      movement.email,
    );

    if (!account) {
      if (direction === 'debit') {
        throw new NotFoundException(
          `Aucun compte de fidélité pour le client ${movement.clientId}`,
        );
      }

      return this.createAccountWithMovement(manager, movement);
    }

    if (direction === 'debit' && account.pointsBalance < movement.points) {
      throw new BadRequestException(
        `Solde de points insuffisant : ${account.pointsBalance} point(s) disponible(s), ${movement.points} demandé(s)`,
      );
    }

    const delta = direction === 'credit' ? movement.points : -movement.points;
    account.pointsBalance += delta;
    account.totalEarned += direction === 'credit' ? movement.points : 0;
    account.totalSpent += direction === 'debit' ? movement.points : 0;

    if (movement.email && !account.clientEmail) {
      account.clientEmail = movement.email;
    }

    const savedAccount = await manager
      .getRepository(LoyaltyAccount)
      .save(account);

    const transaction = await this.recordTransaction(manager, {
      loyaltyAccountId: savedAccount.id,
      points: delta,
      type: movement.type,
      description: movement.description,
    });

    return { account: this.toBalance(savedAccount), transaction };
  }

  private async createAccountWithMovement(
    manager: EntityManager,
    movement: NormalizedMovement,
  ): Promise<LoyaltyMovementResult> {
    const repository = manager.getRepository(LoyaltyAccount);

    const account = repository.create({
      tenantId: requireTenantId(),
      clientId: movement.clientId,
      clientEmail: movement.email,
      pointsBalance: movement.points,
      totalEarned: movement.points,
      totalSpent: 0,
    });

    const savedAccount = await repository.save(account);

    const transaction = await this.recordTransaction(manager, {
      loyaltyAccountId: savedAccount.id,
      points: movement.points,
      type: movement.type,
      description: movement.description,
    });

    return { account: this.toBalance(savedAccount), transaction };
  }

  /** --- Helpers --- */

  private async requireAccount(identifier: string): Promise<LoyaltyAccount> {
    const account = await this.resolveAccount(identifier);

    if (!account) {
      throw new NotFoundException(
        `Aucun compte de fidélité pour « ${identifier} »`,
      );
    }

    return account;
  }

  /** Retrouve un compte par identifiant client ou par email (insensible à la casse). */
  private resolveAccount(identifier: string): Promise<LoyaltyAccount | null> {
    const value = identifier?.trim();

    if (!value) {
      throw new BadRequestException('Identifiant client requis');
    }

    return this.accountRepository.findOne({
      where: this.buildWhere(value, requireTenantId()),
    });
  }

  /**
   * Verrouille le compte dans la transaction courante.
   * `findOne` avec lock nécessite une transaction active (garanti par l'appelant).
   */
  private lockAccount(
    manager: EntityManager,
    clientId: string,
    email: string | null,
  ): Promise<LoyaltyAccount | null> {
    const tenantId = requireTenantId();
    const where: FindOptionsWhere<LoyaltyAccount>[] = [
      { tenantId, clientId },
    ];

    if (email) {
      where.push({ tenantId, clientEmail: email });
    }

    return manager.getRepository(LoyaltyAccount).findOne({
      where,
      lock: { mode: 'pessimistic_write' },
    });
  }

  private buildWhere(
    value: string,
    tenantId: string,
  ): FindOptionsWhere<LoyaltyAccount>[] {
    const where: FindOptionsWhere<LoyaltyAccount>[] = [
      { tenantId, clientId: value },
    ];

    if (value.includes('@')) {
      where.push({ tenantId, clientEmail: value.toLowerCase() });
    }

    return where;
  }

  private recordTransaction(
    manager: EntityManager,
    data: {
      loyaltyAccountId: string;
      points: number;
      type: LoyaltyTransactionType;
      description: string | null;
    },
  ): Promise<LoyaltyTransaction> {
    const repository = manager.getRepository(LoyaltyTransaction);
    return repository.save(
      repository.create({ ...data, tenantId: requireTenantId() }),
    );
  }

  private normalizePoints(points: number): number {
    if (!Number.isInteger(points) || points <= 0) {
      throw new BadRequestException(
        'Le nombre de points doit être un entier strictement positif',
      );
    }

    return points;
  }

  private toBalance(account: LoyaltyAccount): LoyaltyBalance {
    return {
      id: account.id,
      clientId: account.clientId,
      clientEmail: account.clientEmail,
      pointsBalance: account.pointsBalance,
      totalEarned: account.totalEarned,
      totalSpent: account.totalSpent,
    };
  }
}
