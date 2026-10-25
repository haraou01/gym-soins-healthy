const { randomUUID } = require('node:crypto');
const { assertSafeTestTarget, displayTarget } = require('./lib/safe-target');
const { Client } = require('pg');

const baseUrl = (
  process.env.LOAD_BASE_URL || 'http://127.0.0.1:3000/api/v1'
).replace(/\/$/, '');
const email = process.env.LOAD_EMAIL || 'admin.e2e@gymsoins.local';
const password = process.env.LOAD_PASSWORD || 'AdminE2E123!';
const requests = Number(process.env.LOAD_REQUESTS || 20);
const concurrency = Number(process.env.LOAD_CONCURRENCY || 10);

let token = '';
const cleanup = {
  saleIds: [],
  bookingClientPrefixes: [],
  kdsClientPrefixes: [],
  kdsOrderIds: [],
  productSkus: [],
  ingredientIds: [],
  dishIds: [],
};

async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

async function login() {
  const response = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (response.status !== 200 || !response.body?.access_token) {
    throw new Error(`Login échoué: ${JSON.stringify(response.body)}`);
  }
  token = response.body.access_token;
}

async function pool(total, parallel, task) {
  let next = 0;
  const results = [];
  const startedAt = Date.now();
  const workers = Array.from(
    { length: Math.min(parallel, total) },
    async () => {
      while (true) {
        const index = next;
        next += 1;
        if (index >= total) return;
        const start = Date.now();
        try {
          const response = await task(index);
          results.push({
            status: response.status,
            durationMs: Date.now() - start,
            body: response.body,
          });
        } catch (error) {
          results.push({
            status: 0,
            durationMs: Date.now() - start,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    },
  );
  await Promise.all(workers);
  const durationMs = Date.now() - startedAt;
  return { results, durationMs };
}

function summarize(name, run, parallel = concurrency) {
  const durations = run.results.map((r) => r.durationMs).sort((a, b) => a - b);
  const percentile = (p) =>
    durations.length === 0
      ? 0
      : durations[Math.min(durations.length - 1, Math.ceil((p / 100) * durations.length) - 1)];
  const statuses = {};
  for (const result of run.results) {
    statuses[result.status] = (statuses[result.status] || 0) + 1;
  }
  return {
    scenario: name,
    requests: run.results.length,
    concurrency: parallel,
    durationMs: run.durationMs,
    throughputRps: Number(
      (run.results.length / Math.max(run.durationMs, 1) * 1000).toFixed(2),
    ),
    p50Ms: percentile(50),
    p95Ms: percentile(95),
    p99Ms: percentile(99),
    statuses,
    errors: run.results.filter((r) => r.status === 0).length,
  };
}

async function runBooking(total = requests, parallel = concurrency) {
  const prefix = `load-booking-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  cleanup.bookingClientPrefixes.push(prefix);
  const start = Date.now() + 3_600_000;
  const end = start + 3_600_000;

  const unique = await pool(total, parallel, (index) =>
    api('/bookings', {
      method: 'POST',
      body: JSON.stringify({
        clientId: `${prefix}-u-${index}`,
        resourceType: 'EQUIPMENT',
        resourceId: randomUUID(),
        practitionerOrCoachId: `${prefix}-prac-${index}`,
        startTime: new Date(start).toISOString(),
        endTime: new Date(end).toISOString(),
      }),
    }),
  );

  const resourceId = randomUUID();
  const conflict = await pool(total, parallel, (index) =>
    api('/bookings', {
      method: 'POST',
      body: JSON.stringify({
        clientId: `${prefix}-c-${index}`,
        resourceType: 'EQUIPMENT',
        resourceId,
        practitionerOrCoachId: `${prefix}-prac-conflict`,
        startTime: new Date(start).toISOString(),
        endTime: new Date(end).toISOString(),
      }),
    }),
  );

  return [
    summarize(`booking-unique-${total}@${parallel}`, unique, parallel),
    summarize(`booking-conflict-${total}@${parallel}`, conflict, parallel),
  ];
}

async function runShop(total = requests, parallel = concurrency) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const sku = `LOAD-SHOP-${suffix}`;
  cleanup.productSkus.push(sku);
  const product = await api('/shop', {
    method: 'POST',
    body: JSON.stringify({
      name: `Load product ${suffix}`,
      sku,
      price: 10,
      stockQuantity: total,
      category: 'BOISSON',
      isActive: true,
    }),
  });
  if (product.status !== 201) throw new Error(JSON.stringify(product.body));

  const run = await pool(total, parallel, (index) =>
    api('/shop/sales/process', {
      method: 'POST',
      headers: { 'Idempotency-Key': `load-shop-${suffix}-${index}` },
      body: JSON.stringify({
        items: [{ productId: product.body.id, quantity: 1 }],
        paymentMethod: 'ESPECES',
      }),
    }),
  );
  for (const result of run.results) {
    if (result.status === 201 && result.body?.saleId) {
      cleanup.saleIds.push(result.body.saleId);
    }
  }

  return [summarize(`shop-sales-${total}@${parallel}`, run, parallel)];
}

async function runKds(total = requests, parallel = concurrency) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const ingredientName = `Load ingredient ${suffix}`;
  const ingredient = await api('/healthy-food/ingredients', {
    method: 'POST',
    body: JSON.stringify({
      name: ingredientName,
      unit: 'UNITE',
      stockQuantity: total,
      alertThreshold: 0,
    }),
  });
  if (ingredient.status !== 201) throw new Error(JSON.stringify(ingredient.body));
  cleanup.ingredientIds.push(ingredient.body.id);

  const dish = await api('/healthy-food/dishes', {
    method: 'POST',
    body: JSON.stringify({
      name: `Load dish ${suffix}`,
      price: 10,
      category: 'PLAT',
      isAvailable: true,
      type: 'SUR_COMMANDE',
    }),
  });
  if (dish.status !== 201) throw new Error(JSON.stringify(dish.body));
  cleanup.dishIds.push(dish.body.id);

  await api(`/healthy-food/dishes/${dish.body.id}/ingredients`, {
    method: 'POST',
    body: JSON.stringify({
      ingredientId: ingredient.body.id,
      quantityNeeded: 1,
    }),
  });

  const prefix = `load-kds-${suffix}`;
  cleanup.kdsClientPrefix = prefix;
  const run = await pool(total, parallel, (index) =>
    api('/healthy-food/orders', {
      method: 'POST',
      headers: { 'Idempotency-Key': `load-kds-${suffix}-${index}` },
      body: JSON.stringify({
        clientId: `${prefix}-${index}`,
        type: 'SUR_PLACE',
        items: [{ dishId: dish.body.id, quantity: 1 }],
      }),
    }),
  );

  const orderIds = run.results
    .filter((result) => result.status === 201 && result.body?.id)
    .map((result) => result.body.id);
  cleanup.kdsOrderIds.push(...orderIds);

  const statusRun = await pool(orderIds.length, parallel, (index) =>
    api(`/healthy-food/orders/${orderIds[index]}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'EN_PREPARATION' }),
    }),
  );

  return [
    summarize(`kds-orders-${total}@${parallel}`, run, parallel),
    summarize(`kds-status-${total}@${parallel}`, statusRun, parallel),
  ];
}

async function metricsSnapshot() {
  const response = await api('/observability/metrics');
  if (response.status !== 200) return null;

  const wanted = [
    'outbox_events{',
    'db_connections',
    'db_max_connections',
    'db_locks{',
    'outbox_worker',
    'http_requests_total',
  ];
  return String(response.body)
    .split('\n')
    .filter((line) => wanted.some((prefix) => line.startsWith(prefix)))
    .slice(0, 50);
}

async function cleanupDatabase() {
  if (process.env.LOAD_CLEANUP === 'false') return;
  if (!process.env.POSTGRES_DATABASE) return;

  const client = new Client({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: Number(process.env.POSTGRES_PORT || 5432),
    user: process.env.POSTGRES_USERNAME || 'admin',
    password: process.env.POSTGRES_PASSWORD || '',
    database: process.env.POSTGRES_DATABASE,
  });

  await client.connect();

  try {
    for (const prefix of cleanup.bookingClientPrefixes) {
      await client.query('DELETE FROM bookings WHERE "clientId" LIKE $1', [
        `${prefix}%`,
      ]);
    }

    if (cleanup.productSkus.length > 0) {
      const products = await client.query(
        'SELECT id FROM products WHERE sku = ANY($1::text[])',
        [cleanup.productSkus],
      );
      const ids = products.rows.map((row) => row.id);
      if (ids.length > 0) {
        const saleRows = await client.query(
          'SELECT DISTINCT "saleId" FROM sale_items WHERE "productId" = ANY($1::uuid[])',
          [ids],
        );
        const saleIds = saleRows.rows.map((row) => row.saleId);
        await client.query(
          'DELETE FROM sale_items WHERE "productId" = ANY($1::uuid[])',
          [ids],
        );
        if (saleIds.length > 0) {
          await client.query(
            'DELETE FROM sales WHERE id = ANY($1::uuid[])',
            [saleIds],
          );
        }
        await client.query('DELETE FROM products WHERE id = ANY($1::uuid[])', [
          ids,
        ]);
      }
    }

    if (cleanup.saleIds.length > 0) {
      await client.query(
        'DELETE FROM outbox_events WHERE "aggregateId" = ANY($1::text[])',
        [cleanup.saleIds],
      );
    }

    if (cleanup.kdsOrderIds.length > 0) {
      await client.query(
        'DELETE FROM outbox_events WHERE "aggregateId" = ANY($1::text[])',
        [cleanup.kdsOrderIds],
      );
    }

    for (const prefix of cleanup.kdsClientPrefixes) {
      await client.query('DELETE FROM kitchen_orders WHERE "clientId" LIKE $1', [
        `${prefix}%`,
      ]);
    }

    if (cleanup.dishIds.length > 0) {
      await client.query(
        'DELETE FROM dish_ingredients WHERE "dishId" = ANY($1::uuid[])',
        [cleanup.dishIds],
      );
      await client.query('DELETE FROM dishes WHERE id = ANY($1::uuid[])', [
        cleanup.dishIds,
      ]);
    }

    if (cleanup.ingredientIds.length > 0) {
      await client.query(
        'DELETE FROM ingredients WHERE id = ANY($1::uuid[])',
        [cleanup.ingredientIds],
      );
    }
  } finally {
    await client.end();
  }
}

async function main() {
  const safetyTarget = assertSafeTestTarget({
    host: process.env.POSTGRES_HOST || '127.0.0.1',
    port: Number(process.env.POSTGRES_PORT || 55432),
    database: process.env.POSTGRES_DATABASE || 'gymsoins_test',
    mode: 'destructive',
  });
  console.log(`[safe-target] ${displayTarget(safetyTarget)}`);

  await login();

  const scenario = process.env.LOAD_SCENARIO || 'all';
  const results = [];

  try {
    if (scenario === 'all' || scenario === 'booking') {
      results.push(...(await runBooking()));
    }
    if (scenario === 'all' || scenario === 'shop') {
      results.push(...(await runShop()));
    }
    if (scenario === 'all' || scenario === 'kds') {
      results.push(...(await runKds()));
    }
    if (scenario === 'matrix') {
      for (const [total, parallel] of [
        [100, 10],
        [100, 25],
        [100, 50],
        [500, 25],
        [500, 50],
      ]) {
        results.push(...(await runBooking(total, parallel)));
      }
      for (const [total, parallel] of [
        [100, 25],
        [500, 50],
      ]) {
        results.push(...(await runShop(total, parallel)));
      }
      for (const [total, parallel] of [
        [100, 25],
        [500, 50],
      ]) {
        results.push(...(await runKds(total, parallel)));
      }
    }

    const metrics = await metricsSnapshot();
    process.stdout.write(
      `${JSON.stringify(
        {
          event: 'load.completed',
          requests,
          concurrency,
          results,
          metrics,
          timestamp: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await cleanupDatabase();
  }
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({
      event: 'load.failed',
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    })}\n`,
  );
  process.exit(1);
});
