const { randomUUID } = require('node:crypto');
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
  bookingClientPrefix: '',
  kdsClientPrefix: '',
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

function summarize(name, run) {
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
    concurrency,
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

async function runBooking() {
  const prefix = `load-booking-${Date.now()}`;
  cleanup.bookingClientPrefix = prefix;
  const start = Date.now() + 3_600_000;
  const end = start + 3_600_000;

  const unique = await pool(requests, concurrency, (index) =>
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
  const conflict = await pool(requests, concurrency, (index) =>
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

  return [summarize('booking-unique', unique), summarize('booking-conflict', conflict)];
}

async function runShop() {
  const suffix = Date.now();
  const sku = `LOAD-SHOP-${suffix}`;
  cleanup.productSkus.push(sku);
  const product = await api('/shop', {
    method: 'POST',
    body: JSON.stringify({
      name: `Load product ${suffix}`,
      sku,
      price: 10,
      stockQuantity: requests,
      category: 'BOISSON',
      isActive: true,
    }),
  });
  if (product.status !== 201) throw new Error(JSON.stringify(product.body));

  const run = await pool(requests, concurrency, (index) =>
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
    void result;
  }

  return [summarize('shop-sales', run)];
}

async function runKds() {
  const suffix = Date.now();
  const ingredientName = `Load ingredient ${suffix}`;
  const ingredient = await api('/healthy-food/ingredients', {
    method: 'POST',
    body: JSON.stringify({
      name: ingredientName,
      unit: 'UNITE',
      stockQuantity: requests,
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
  const run = await pool(requests, concurrency, (index) =>
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

  return [summarize('kds-orders', run)];
}

async function metricsSnapshot() {
  const response = await api('/observability/metrics');
  if (response.status !== 200) return null;

  const wanted = [
    'outbox_events{',
    'db_connections',
    'http_requests_total',
  ];
  return String(response.body)
    .split('\n')
    .filter((line) => wanted.some((prefix) => line.startsWith(prefix)))
    .slice(0, 20);
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
    if (cleanup.bookingClientPrefix) {
      await client.query('DELETE FROM bookings WHERE "clientId" LIKE $1', [
        `${cleanup.bookingClientPrefix}%`,
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

    if (cleanup.kdsClientPrefix) {
      await client.query('DELETE FROM kitchen_orders WHERE "clientId" LIKE $1', [
        `${cleanup.kdsClientPrefix}%`,
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
