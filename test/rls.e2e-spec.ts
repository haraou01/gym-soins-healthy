import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';

import {
  getTestDatabaseSettings,
  resetTestDatabase,
  TestDatabaseSettings,
} from './utils/test-database';

interface PgError {
  code?: string;
  message?: string;
}

describe('Phase 5 — RLS PostgreSQL avec rôle runtime', () => {
  let settings: TestDatabaseSettings;
  let owner: Client;
  let app: Client;
  let worker: Client;
  let retention: Client;
  let tenantA: string;
  let tenantB: string;
  let productA: string;
  let productB: string;
  let saleA: string;
  let saleB: string;

  const connection = (user: string, password: string) => ({
    host: settings.host,
    port: settings.port,
    user,
    password,
    database: settings.database,
  });

  const asTenant = async <T>(
    client: Client,
    tenantId: string,
    callback: () => Promise<T>,
  ): Promise<T> => {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [
      tenantId,
    ]);

    try {
      const result = await callback();
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  };

  beforeAll(async () => {
    settings = getTestDatabaseSettings();
    await resetTestDatabase(settings);

    owner = new Client(connection(settings.user, settings.password));
    app = new Client(
      connection(settings.runtimeUser, settings.runtimePassword),
    );
    worker = new Client(
      connection(settings.workerUser, settings.workerPassword),
    );
    retention = new Client(
      connection(settings.retentionUser, settings.retentionPassword),
    );

    await Promise.all([
      owner.connect(),
      app.connect(),
      worker.connect(),
      retention.connect(),
    ]);

    tenantA = randomUUID();
    tenantB = randomUUID();

    await owner.query(
      `INSERT INTO tenants (id, slug, name, status)
       VALUES ($1, $2, 'RLS tenant A', 'ACTIVE'),
              ($3, $4, 'RLS tenant B', 'ACTIVE')`,
      [tenantA, `rls-a-${tenantA.slice(0, 8)}`, tenantB, `rls-b-${tenantB.slice(0, 8)}`],
    );

    const products = await owner.query(
      `INSERT INTO products
        ("tenantId", name, sku, price, "stockQuantity", category, "isService", "isActive")
       VALUES
        ($1, 'RLS product A', $2, 10, 5, 'BOISSON', false, true),
        ($3, 'RLS product B', $4, 20, 5, 'BOISSON', false, true)
       RETURNING id, "tenantId"`,
      [tenantA, `RLS-A-${tenantA.slice(0, 8)}`, tenantB, `RLS-B-${tenantB.slice(0, 8)}`],
    );

    productA = products.rows.find((row) => row.tenantId === tenantA).id;
    productB = products.rows.find((row) => row.tenantId === tenantB).id;

    const sales = await owner.query(
      `INSERT INTO sales ("tenantId", "clientId", "totalAmount", "paymentMethod", status)
       VALUES ($1, 'rls-client-a', 10, 'ESPECES', 'COMPLETED'),
              ($2, 'rls-client-b', 20, 'ESPECES', 'COMPLETED')
       RETURNING id, "tenantId"`,
      [tenantA, tenantB],
    );

    saleA = sales.rows.find((row) => row.tenantId === tenantA).id;
    saleB = sales.rows.find((row) => row.tenantId === tenantB).id;

    await owner.query(
      `INSERT INTO sale_items
        ("tenantId", "saleId", "productId", quantity, "unitPrice", "totalPrice")
       VALUES
        ($1, $2, $3, 1, 10, 10),
        ($4, $5, $6, 1, 20, 20)`,
      [tenantA, saleA, productA, tenantB, saleB, productB],
    );

    await owner.query(
      `INSERT INTO outbox_events
        ("tenantId", "eventType", "aggregateType", "aggregateId", payload, status, attempts, "availableAt", "createdAt", "updatedAt")
       VALUES
        ($1, 'rls.test', 'test', 'rls-a', '{}'::jsonb, 'PROCESSED', 1, NOW(), NOW(), NOW()),
        ($2, 'rls.test', 'test', 'rls-b', '{}'::jsonb, 'PROCESSED', 1, NOW(), NOW(), NOW())`,
      [tenantA, tenantB],
    );

    await owner.query(
      `INSERT INTO idempotency_keys
        ("tenantId", scope, "key", "requestHash", status, response)
       VALUES
        ($1, 'rls.scope', 'same-key', 'hash-a', 'COMPLETED', '{}'::jsonb),
        ($2, 'rls.scope', 'same-key', 'hash-b', 'COMPLETED', '{}'::jsonb)`,
      [tenantA, tenantB],
    );

    await owner.query(
      `INSERT INTO kds_stream_tickets
        ("tokenHash", "userId", role, "tenantId", "expiresAt")
       VALUES ('rls-ticket-hash', 'rls-user-a', 'CHEF', $1, NOW() + INTERVAL '1 minute')`,
      [tenantA],
    );

    await owner.query(
      `INSERT INTO outbox_events
        ("tenantId", "eventType", "aggregateType", "aggregateId", payload, status, attempts, "availableAt", "processedAt", "createdAt", "updatedAt")
       VALUES
        ($1, 'kitchen.order.status_changed', 'kitchen_order', 'rls-kds-a', '{"orderId":"rls-kds-a"}'::jsonb, 'PROCESSED', 1, NOW(), NOW(), NOW(), NOW()),
        ($2, 'kitchen.order.status_changed', 'kitchen_order', 'rls-kds-b', '{"orderId":"rls-kds-b"}'::jsonb, 'PROCESSED', 1, NOW(), NOW(), NOW(), NOW())`,
      [tenantA, tenantB],
    );
  }, 180_000);

  afterAll(async () => {
    await Promise.all([
      owner?.end().catch(() => undefined),
      app?.end().catch(() => undefined),
      worker?.end().catch(() => undefined),
      retention?.end().catch(() => undefined),
    ]);
  });

  it('utilise un rôle runtime non superuser et sans BYPASSRLS', async () => {
    const result = await app.query(
      `SELECT current_user,
              rolsuper,
              rolbypassrls
       FROM pg_roles
       WHERE rolname = current_user`,
    );

    expect(result.rows[0]).toMatchObject({
      current_user: settings.runtimeUser,
      rolsuper: false,
      rolbypassrls: false,
    });
  });

  it('force RLS sur les tables tenant-owned', async () => {
    const result = await app.query(
      `SELECT relname, relrowsecurity, relforcerowsecurity
       FROM pg_class
       WHERE relname IN ('products', 'outbox_events', 'kds_stream_tickets')`,
    );

    expect(result.rows).toHaveLength(3);

    for (const row of result.rows) {
      expect(row.relrowsecurity).toBe(true);
      expect(row.relforcerowsecurity).toBe(true);
    }
  });

  it('ne retourne aucune ligne sans contexte tenant', async () => {
    const products = await app.query('SELECT COUNT(*)::int AS n FROM products');
    const outbox = await app.query('SELECT COUNT(*)::int AS n FROM outbox_events');
    const idempotency = await app.query(
      'SELECT COUNT(*)::int AS n FROM idempotency_keys',
    );

    expect(products.rows[0].n).toBe(0);
    expect(outbox.rows[0].n).toBe(0);
    expect(idempotency.rows[0].n).toBe(0);
  });

  it('isole SELECT, INSERT, UPDATE et DELETE entre A et B', async () => {
    const selected = await asTenant(app, tenantA, () =>
      app.query('SELECT id, "tenantId" FROM products ORDER BY name'),
    );

    expect(selected.rows).toHaveLength(1);
    expect(selected.rows[0].id).toBe(productA);

    const inserted = await asTenant(app, tenantA, () =>
      app.query(
        `INSERT INTO products
          ("tenantId", name, sku, price, "stockQuantity", category, "isService", "isActive")
         VALUES ($1, 'RLS injected B', 'RLS-INJECT-B', 1, 1, 'BOISSON', false, true)`,
        [tenantB],
      ).then(() => 'inserted').catch((error: PgError) => error.code),
    );

    expect(inserted).toBe('42501');

    const updated = await asTenant(app, tenantA, () =>
      app.query('UPDATE products SET name = $1 WHERE "tenantId" = $2', [
        'hacked',
        tenantB,
      ]),
    );
    expect(updated.rowCount).toBe(0);

    const deleted = await asTenant(app, tenantA, () =>
      app.query('DELETE FROM products WHERE "tenantId" = $1', [tenantB]),
    );
    expect(deleted.rowCount).toBe(0);

    const changedTenant = await asTenant(app, tenantA, () =>
      app.query('UPDATE products SET "tenantId" = $1 WHERE "tenantId" = $2', [
        tenantB,
        tenantA,
      ]).then(() => 'updated').catch((error: PgError) => error.code),
    );
    expect(changedTenant).toBe('42501');
  });

  it('refuse un contexte vide ou invalide', async () => {
    const empty = await asTenant(app, '', () =>
      app.query('SELECT COUNT(*)::int AS n FROM products'),
    );
    expect(empty.rows[0].n).toBe(0);

    await expect(
      asTenant(app, 'not-a-valid-uuid', () =>
        app.query('SELECT COUNT(*)::int AS n FROM products'),
      ),
    ).rejects.toMatchObject({ code: '22P02' });
  });

  it('réinitialise le contexte après rollback et erreur SQL', async () => {
    await app.query('BEGIN');
    await app.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
    const a = await app.query('SELECT COUNT(*)::int AS n FROM products');
    expect(a.rows[0].n).toBe(1);
    await app.query('ROLLBACK');

    const afterRollback = await app.query('SELECT COUNT(*)::int AS n FROM products');
    expect(afterRollback.rows[0].n).toBe(0);

    await app.query('BEGIN');
    await app.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
    await expect(app.query('SELECT * FROM table_that_does_not_exist')).rejects.toBeDefined();
    await app.query('ROLLBACK');

    const recovered = await asTenant(app, tenantA, () =>
      app.query('SELECT COUNT(*)::int AS n FROM products'),
    );
    expect(recovered.rows[0].n).toBe(1);
  });

  it('ne fuit pas lors de la réutilisation séquentielle d’une connexion pool', async () => {
    const pool = new Pool({
      host: settings.host,
      port: settings.port,
      user: settings.runtimeUser,
      password: settings.runtimePassword,
      database: settings.database,
      max: 1,
    });

    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      const first = await client.query('SELECT COUNT(*)::int AS n FROM products');
      expect(first.rows[0].n).toBe(1);
      await client.query('COMMIT');

      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantB]);
      const second = await client.query('SELECT COUNT(*)::int AS n FROM products');
      expect(second.rows[0].n).toBe(1);
      await client.query('COMMIT');
    } finally {
      client.release();
      await pool.end();
    }
  });

  it('isole des transactions concurrentes A/B dans le pool', async () => {
    const pool = new Pool({
      host: settings.host,
      port: settings.port,
      user: settings.runtimeUser,
      password: settings.runtimePassword,
      database: settings.database,
      max: 4,
    });

    const run = (tenantId: string) =>
      new Promise<number>((resolve, reject) => {
        pool
          .connect()
          .then(async (client) => {
            try {
              await client.query('BEGIN');
              await client.query("SELECT set_config('app.tenant_id', $1, true)", [
                tenantId,
              ]);
              const result = await client.query(
                'SELECT COUNT(*)::int AS n FROM products',
              );
              await client.query('COMMIT');
              resolve(result.rows[0].n);
            } catch (error) {
              await client.query('ROLLBACK').catch(() => undefined);
              reject(error);
            } finally {
              client.release();
            }
          })
          .catch(reject);
      });

    const [a, b] = await Promise.all([run(tenantA), run(tenantB)]);
    expect(a).toBe(1);
    expect(b).toBe(1);

    await pool.end();
  });

  it('protège les relations parent/enfant par tenant', async () => {
    const wrongParent = await asTenant(app, tenantA, () =>
      app.query(
        `INSERT INTO sale_items
          ("tenantId", "saleId", "productId", quantity, "unitPrice", "totalPrice")
         VALUES ($1, $2, $3, 1, 10, 10)`,
        [tenantA, saleB, productA],
      ).then(() => 'inserted').catch((error: PgError) => error.code),
    );

    expect(['23503', '42501']).toContain(wrongParent);

    const wrongChildTenant = await asTenant(app, tenantA, () =>
      app.query(
        `INSERT INTO sale_items
          ("tenantId", "saleId", "productId", quantity, "unitPrice", "totalPrice")
         VALUES ($1, $2, $3, 1, 10, 10)`,
        [tenantB, saleA, productA],
      ).then(() => 'inserted').catch((error: PgError) => error.code),
    );

    expect(wrongChildTenant).toBe('42501');
  });

  it('adapte app, worker et retention à l’Outbox', async () => {
    const appA = await asTenant(app, tenantA, () =>
      app.query('SELECT COUNT(*)::int AS n FROM outbox_events'),
    );
    expect(appA.rows[0].n).toBe(2);

    const workerAll = await worker.query(
      'SELECT COUNT(*)::int AS n FROM outbox_events',
    );
    expect(workerAll.rows[0].n).toBeGreaterThanOrEqual(3);

    const workerTenant = await asTenant(worker, tenantB, () =>
      worker.query('SELECT COUNT(*)::int AS n FROM products'),
    );
    expect(workerTenant.rows[0].n).toBe(1);

    const retentionAll = await retention.query(
      'SELECT COUNT(*)::int AS n FROM outbox_events',
    );
    expect(retentionAll.rows[0].n).toBeGreaterThanOrEqual(3);

    await expect(
      worker.query('SELECT COUNT(*)::int AS n FROM users'),
    ).rejects.toMatchObject({ code: '42501' });

    await expect(
      retention.query('SELECT COUNT(*)::int AS n FROM products'),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('consomme un ticket SSE via la fonction contrôlée', async () => {
    const direct = await app.query(
      'SELECT COUNT(*)::int AS n FROM kds_stream_tickets',
    );
    expect(direct.rows[0].n).toBe(0);

    const consumed = await app.query(
      `SELECT "userId", role, "tenantId"
       FROM consume_kds_stream_ticket('rls-ticket-hash')`,
    );

    expect(consumed.rows).toHaveLength(1);
    expect(consumed.rows[0]).toMatchObject({
      userId: 'rls-user-a',
      role: 'CHEF',
      tenantId: tenantA,
    });

    const replay = await app.query(
      `SELECT "userId", role, "tenantId"
       FROM consume_kds_stream_ticket('rls-ticket-hash')`,
    );
    expect(replay.rows).toHaveLength(0);
  });

  it('limite la lecture Outbox KDS cross-tenant à la fonction contrôlée', async () => {
    const result = await app.query(
      `SELECT "tenantId", "eventType", payload
       FROM list_kds_outbox_events(NOW() - INTERVAL '1 hour', 100)`,
    );

    const tenants = new Set(result.rows.map((row) => row.tenantId));
    expect(tenants.has(tenantA)).toBe(true);
    expect(tenants.has(tenantB)).toBe(true);

    // Aucun accès direct global à la table Outbox.
    const direct = await app.query(
      'SELECT COUNT(*)::int AS n FROM outbox_events',
    );
    expect(direct.rows[0].n).toBe(0);
  });

  it('autorise les tables globales et refuse schema_migrations', async () => {
    await expect(app.query('SELECT COUNT(*)::int FROM tenants')).resolves.toBeDefined();
    await expect(app.query('SELECT COUNT(*)::int FROM users')).resolves.toBeDefined();
    await expect(app.query('SELECT COUNT(*)::int FROM settings')).resolves.toBeDefined();

    await expect(
      app.query('SELECT COUNT(*)::int FROM schema_migrations'),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('ne permet pas au runtime de désactiver RLS ou de changer de rôle', async () => {
    await app.query('SET row_security = off');

    await expect(
      app.query('SELECT COUNT(*)::int AS n FROM products'),
    ).rejects.toMatchObject({ code: '42501' });

    await expect(
      app.query('ALTER TABLE products DISABLE ROW LEVEL SECURITY'),
    ).rejects.toMatchObject({ code: '42501' });

    await expect(app.query('SET ROLE gymsoins')).rejects.toBeDefined();

    // Rétablit la session de test pour les assertions suivantes.
    await app.query('SET row_security = on');
  });

  it('refuse la suppression globale par le rôle app et l’autorise à retention', async () => {
    await expect(
      app.query('DELETE FROM outbox_events WHERE "tenantId" = $1', [tenantB]),
    ).resolves.toMatchObject({ rowCount: 0 });

    await expect(
      retention.query('DELETE FROM outbox_events WHERE "tenantId" = $1', [
        tenantB,
      ]),
    ).resolves.toBeDefined();
  });
});
