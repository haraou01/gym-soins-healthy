import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { EntityManager } from 'typeorm';

export const IDEMPOTENCY_SCOPES = {
  SHOP_SALE: 'shop.sale',
  CARE_CONSUME: 'care.consume',
  HEALTHY_FOOD_ORDER: 'healthy_food.order',
  LOYALTY_SALE_COMPLETED: 'loyalty.sale.completed',
} as const;

export interface IdempotentResult<T> {
  value: T;
  replayed: boolean;
}

/**
 * Idempotence transactionnelle PostgreSQL.
 *
 * Le verrou est assuré par la contrainte UNIQUE (`scope`, `key`) et
 * `INSERT ... ON CONFLICT DO NOTHING`. Aucun `SELECT puis INSERT` non protégé.
 *
 * L'appelant doit fournir un EntityManager issu d'une transaction : la clé,
 * la réponse et l'opération métier sont ainsi commitées ou annulées ensemble.
 */
@Injectable()
export class IdempotencyService {
  async execute<T>(
    manager: EntityManager,
    scope: string,
    rawKey: string | undefined,
    payload: unknown,
    handler: () => Promise<T>,
  ): Promise<IdempotentResult<T>> {
    const key = this.normalizeKey(rawKey);

    if (!key) {
      return { value: await handler(), replayed: false };
    }

    const requestHash = this.hash(payload);

    const inserted = await manager.query(
      `
        INSERT INTO "idempotency_keys"
          ("scope", "key", "requestHash", "status")
        VALUES ($1, $2, $3, 'PROCESSING')
        ON CONFLICT ("scope", "key") DO NOTHING
        RETURNING "id"
      `,
      [scope, key, requestHash],
    );

    if (inserted.length === 0) {
      const existingRows = await manager.query(
        `
          SELECT "id", "requestHash", "status", "response"
          FROM "idempotency_keys"
          WHERE "scope" = $1 AND "key" = $2
        `,
        [scope, key],
      );

      const existing = existingRows[0];

      if (!existing) {
        // Cas très rare : la ligne conflictuelle a été supprimée entre-temps.
        throw new ConflictException(
          'Idempotency-Key en conflit ; veuillez réessayer.',
        );
      }

      if (existing.requestHash !== requestHash) {
        throw new ConflictException(
          'Idempotency-Key déjà utilisée avec un payload différent.',
        );
      }

      if (existing.status === 'COMPLETED' && existing.response !== null) {
        return { value: existing.response as T, replayed: true };
      }

      throw new ConflictException(
        `Idempotency-Key déjà en cours de traitement (${existing.status}).`,
      );
    }

    const id = inserted[0].id;
    const value = await handler();
    const serializedResponse = JSON.stringify(value) ?? 'null';

    await manager.query(
      `
        UPDATE "idempotency_keys"
        SET "status" = 'COMPLETED',
            "response" = $1::jsonb,
            "updatedAt" = NOW()
        WHERE "id" = $2
      `,
      [serializedResponse, id],
    );

    return { value, replayed: false };
  }

  private normalizeKey(rawKey?: string): string | undefined {
    const key = rawKey?.trim();

    if (!key) {
      return undefined;
    }

    if (key.length > 255) {
      throw new BadRequestException(
        'Idempotency-Key ne doit pas dépasser 255 caractères.',
      );
    }

    if (!/^[\x20-\x7E]+$/.test(key)) {
      throw new BadRequestException(
        'Idempotency-Key contient des caractères non autorisés.',
      );
    }

    return key;
  }

  private hash(payload: unknown): string {
    return createHash('sha256')
      .update(this.stableStringify(payload))
      .digest('hex');
  }

  /** Sérialisation déterministe pour que le hash soit stable. */
  private stableStringify(value: unknown): string {
    if (value === undefined) {
      return 'null';
    }

    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }

    if (value instanceof Date) {
      return JSON.stringify(value.toISOString());
    }

    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
    }

    const record = value as Record<string, unknown>;

    return `{${Object.keys(record)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${this.stableStringify(record[key])}`,
      )
      .join(',')}}`;
  }
}
