/* eslint-disable no-console */
const { Client } = require('pg');

const API = (
  process.env.LOAD_MULTI_BASE_URL || 'http://127.0.0.1:3000/api/v1'
).replace(/\/$/, '');
const requests = Number(process.env.LOAD_MULTI_REQUESTS || 100);
const concurrency = Number(process.env.LOAD_MULTI_CONCURRENCY || 25);
const suffix = Date.now();
const password = 'MultiLoad123!';

const cleanup = {
  tenants: [],
  users: [],
  products: [],
  sales: [],
  bookings: [],
  orders: [],
  dishes: [],
  ingredients: [],
};

async function request(token, path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };
  const response = await fetch(`${API}${path}`, { ...options, headers });
  const text = await response.text();
  let body = null;

  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  return { status: response.status, body };
}

async function register(name, ip) {
  const response = await request(
    null,
    '/auth/register',
    {
      method: 'POST',
      headers: { 'X-Forwarded-For': ip },
      body: JSON.stringify({
        email: `load-multi-${name}-${suffix}@gymsoins.local`,
        password,
        username: `load-multi-${name}-${suffix}`,
        tenantName: `Load multi ${name} ${suffix}`,
      }),
    },
  );

  if (response.status !== 201) {
    throw new Error(`Register ${name}: ${JSON.stringify(response.body)}`);
  }

  cleanup.tenants.push(response.body.tenant.id);
  cleanup.users.push(response.body.user.id);
  return response.body;
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
            index,
            status: response.status,
            body: response.body,
            durationMs: Date.now() - start,
          });
        } catch (error) {
          results.push({
            index,
            status: 0,
            durationMs: Date.now() - start,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    },
  );

  await Promise.all(workers);
  return { results, durationMs: Date.now() - startedAt };
}

function summarize(name, run, parallel = concurrency) {
  const durations = run.results
    .map((result) => result.durationMs)
    .sort((a, b) => a - b);
  const percentile = (p) =>
    durations.length === 0
      ? 0
      : durations[
          Math.min(
            durations.length - 1,
            Math.ceil((p / 100) * durations.length) - 1,
          )
        ];
  const statuses = {};

  for (const result of run.results) {
    statuses[result.status] = (statuses[result.status] || 0) + 1;
  }

  return {
    scenario: name,
    requests: run.results.length,
    concurrency: parallel,
    throughputRps: Number(
      ((run.results.length / Math.max(run.durationMs, 1)) * 1000).toFixed(2),
    ),
    p50Ms: percentile(50),
    p95Ms: percentile(95),
    p99Ms: percentile(99),
    statuses,
    errors: run.results.filter((result) => result.status === 0).length,
  };
}

function auth(tenant) {
  return tenant.access_token;
}

async function createShopProduct(tenant, label, stock) {
  const response = await request(auth(tenant), '/shop', {
    method: 'POST',
    body: JSON.stringify({
      name: `Multi load product ${label} ${suffix}`,
      sku: `MULTI-${label}-${suffix}`,
      price: 10,
      stockQuantity: stock,
      category: 'BOISSON',
      isActive: true,
    }),
  });

  if (response.status !== 201) {
    throw new Error(`Product ${label}: ${JSON.stringify(response.body)}`);
  }

  cleanup.products.push(response.body.id);
  return response.body;
}

async function createKdsFixture(tenant, label) {
  const ingredient = await request(auth(tenant), '/healthy-food/ingredients', {
    method: 'POST',
    body: JSON.stringify({
      name: `Multi load ingredient ${label} ${suffix}`,
      unit: 'UNITE',
      stockQuantity: requests,
      alertThreshold: 0,
    }),
  });

  if (ingredient.status !== 201) {
    throw new Error(`Ingredient ${label}: ${JSON.stringify(ingredient.body)}`);
  }

  cleanup.ingredients.push(ingredient.body.id);

  const dish = await request(auth(tenant), '/healthy-food/dishes', {
    method: 'POST',
    body: JSON.stringify({
      name: `Multi load dish ${label} ${suffix}`,
      price: 10,
      category: 'PLAT',
      isAvailable: true,
      type: 'SUR_COMMANDE',
    }),
  });

  if (dish.status !== 201) {
    throw new Error(`Dish ${label}: ${JSON.stringify(dish.body)}`);
  }

  cleanup.dishes.push(dish.body.id);

  await request(
    auth(tenant),
    `/healthy-food/dishes/${dish.body.id}/ingredients`,
    {
      method: 'POST',
      body: JSON.stringify({
        ingredientId: ingredient.body.id,
        quantityNeeded: 1,
      }),
    },
  );

  return dish.body;
}

async function runShop(tenantA, tenantB, productA, productB) {
  const run = async (tenant, product) =>
    pool(requests, concurrency, (index) =>
      request(auth(tenant), '/shop/sales/process', {
        method: 'POST',
        headers: {
          // Même clé dans A et B : doit rester isolée.
          'Idempotency-Key': `multi-shop-${suffix}-${index}`,
        },
        body: JSON.stringify({
          items: [{ productId: product.id, quantity: 1 }],
          paymentMethod: 'ESPECES',
        }),
      }),
    );

  const [a, b] = await Promise.all([run(tenantA, productA), run(tenantB, productB)]);

  for (const [tenant, result] of [
    [tenantA, a],
    [tenantB, b],
  ]) {
    for (const item of result.results) {
      if (item.status === 201 && item.body?.saleId) {
        cleanup.sales.push({ id: item.body.saleId, tenantId: tenant.tenant.id });
      }
    }
  }

  return [
    summarize('shop-A', a),
    summarize('shop-B', b),
  ];
}

async function runBooking(tenantA, tenantB) {
  const start = new Date(Date.now() + 6 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  const run = async (tenant, label) =>
    pool(requests, concurrency, (index) =>
      request(auth(tenant), '/bookings', {
        method: 'POST',
        body: JSON.stringify({
          clientId: `multi-booking-${label}-${suffix}-${index}`,
          resourceType: 'EQUIPMENT',
          resourceId: require('node:crypto').randomUUID(),
          practitionerOrCoachId: `multi-pract-${label}-${suffix}-${index}`,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
        }),
      }),
    );

  const [a, b] = await Promise.all([run(tenantA, 'a'), run(tenantB, 'b')]);

  for (const [tenant, result] of [
    [tenantA, a],
    [tenantB, b],
  ]) {
    for (const item of result.results) {
      if (item.status === 201 && item.body?.id) {
        cleanup.bookings.push({ id: item.body.id, tenantId: tenant.tenant.id });
      }
    }
  }

  return [summarize('booking-A', a), summarize('booking-B', b)];
}

async function runKds(tenantA, tenantB, dishA, dishB) {
  const create = async (tenant, dish, label) =>
    pool(requests, concurrency, (index) =>
      request(auth(tenant), '/healthy-food/orders', {
        method: 'POST',
        headers: {
          'Idempotency-Key': `multi-kds-${suffix}-${label}-${index}`,
        },
        body: JSON.stringify({
          clientId: `multi-kds-${label}-${suffix}-${index}`,
          type: 'SUR_PLACE',
          items: [{ dishId: dish.id, quantity: 1 }],
        }),
      }),
    );

  const [ordersA, ordersB] = await Promise.all([
    create(tenantA, dishA, 'a'),
    create(tenantB, dishB, 'b'),
  ]);

  const orderIds = { a: [], b: [] };

  for (const [label, tenant, result] of [
    ['a', tenantA, ordersA],
    ['b', tenantB, ordersB],
  ]) {
    for (const item of result.results) {
      if (item.status === 201 && item.body?.id) {
        orderIds[label].push(item.body.id);
        cleanup.orders.push({ id: item.body.id, tenantId: tenant.tenant.id });
      }
    }
  }

  const update = async (tenant, ids) =>
    pool(ids.length, concurrency, (index) =>
      request(auth(tenant), `/healthy-food/orders/${ids[index]}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'EN_PREPARATION' }),
      }),
    );

  const [statusA, statusB] = await Promise.all([
    update(tenantA, orderIds.a),
    update(tenantB, orderIds.b),
  ]);

  return [
    summarize('kds-orders-A', ordersA),
    summarize('kds-orders-B', ordersB),
    summarize('kds-status-A', statusA),
    summarize('kds-status-B', statusB),
  ];
}

async function databaseIntegrity(tenantA, tenantB, productA, productB) {
  const db = new Client({
    host: process.env.POSTGRES_HOST || '127.0.0.1',
    port: Number(process.env.POSTGRES_PORT || 55432),
    user: process.env.POSTGRES_USERNAME || 'gymsoins',
    password: process.env.POSTGRES_PASSWORD || 'gymsoins',
    database: process.env.POSTGRES_DATABASE || 'gymsoins_test',
  });
  await db.connect();

  try {
    const productMismatch = await db.query(
      `SELECT COUNT(*)::int AS n FROM products
       WHERE id = ANY($1::uuid[]) AND "tenantId" NOT IN ($2, $3)`,
      [[productA.id, productB.id], tenantA.tenant.id, tenantB.tenant.id],
    );

    const saleIds = cleanup.sales.map((sale) => sale.id);
    const saleMismatch = await db.query(
      `SELECT COUNT(*)::int AS n FROM sales
       WHERE id = ANY($1::uuid[]) AND "tenantId" NOT IN ($2, $3)`,
      [saleIds, tenantA.tenant.id, tenantB.tenant.id],
    );

    const bookingIds = cleanup.bookings.map((booking) => booking.id);
    const bookingMismatch = await db.query(
      `SELECT COUNT(*)::int AS n FROM bookings
       WHERE id = ANY($1::uuid[]) AND "tenantId" NOT IN ($2, $3)`,
      [bookingIds, tenantA.tenant.id, tenantB.tenant.id],
    );

    const orderIds = cleanup.orders.map((order) => order.id);
    const orderMismatch = await db.query(
      `SELECT COUNT(*)::int AS n FROM kitchen_orders
       WHERE id = ANY($1::uuid[]) AND "tenantId" NOT IN ($2, $3)`,
      [orderIds, tenantA.tenant.id, tenantB.tenant.id],
    );

    const aggregateIds = [
      ...saleIds,
      ...orderIds,
    ];
    const outboxMismatch = await db.query(
      `SELECT COUNT(*)::int AS n FROM outbox_events
       WHERE "aggregateId" = ANY($1::text[]) AND "tenantId" NOT IN ($2, $3)`,
      [aggregateIds, tenantA.tenant.id, tenantB.tenant.id],
    );

    const outboxStats = await db.query(
      `SELECT status, COUNT(*)::int AS n
       FROM outbox_events
       WHERE "tenantId" = ANY($1::uuid[])
       GROUP BY status`,
      [[tenantA.tenant.id, tenantB.tenant.id]],
    );

    const tenantCounts = await db.query(
      `SELECT "tenantId", COUNT(*)::int AS n
       FROM kitchen_orders
       WHERE "tenantId" = ANY($1::uuid[])
       GROUP BY "tenantId"`,
      [[tenantA.tenant.id, tenantB.tenant.id]],
    );

    return {
      mismatches:
        productMismatch.rows[0].n +
        saleMismatch.rows[0].n +
        bookingMismatch.rows[0].n +
        orderMismatch.rows[0].n +
        outboxMismatch.rows[0].n,
      outbox: outboxStats.rows,
      tenantCounts: tenantCounts.rows,
    };
  } finally {
    await db.end();
  }
}

async function cleanupDatabase() {
  const db = new Client({
    host: process.env.POSTGRES_HOST || '127.0.0.1',
    port: Number(process.env.POSTGRES_PORT || 55432),
    user: process.env.POSTGRES_USERNAME || 'gymsoins',
    password: process.env.POSTGRES_PASSWORD || 'gymsoins',
    database: process.env.POSTGRES_DATABASE || 'gymsoins_test',
  });
  await db.connect();

  try {
    const tenantIds = cleanup.tenants;
    const saleIds = cleanup.sales.map((sale) => sale.id);
    const bookingIds = cleanup.bookings.map((booking) => booking.id);
    const orderIds = cleanup.orders.map((order) => order.id);

    await db.query('DELETE FROM outbox_events WHERE "tenantId" = ANY($1::uuid[])', [tenantIds]);
    await db.query('DELETE FROM idempotency_keys WHERE "tenantId" = ANY($1::uuid[])', [tenantIds]);
    await db.query('DELETE FROM kds_stream_tickets WHERE "tenantId" = ANY($1::uuid[])', [tenantIds]);

    if (saleIds.length) {
      await db.query('DELETE FROM sale_items WHERE "saleId" = ANY($1::uuid[])', [saleIds]);
      await db.query('DELETE FROM sales WHERE id = ANY($1::uuid[])', [saleIds]);
    }

    if (orderIds.length) {
      await db.query('DELETE FROM kitchen_orders WHERE id = ANY($1::uuid[])', [orderIds]);
    }

    if (bookingIds.length) {
      await db.query('DELETE FROM bookings WHERE id = ANY($1::uuid[])', [bookingIds]);
    }

    if (cleanup.dishes.length) {
      await db.query('DELETE FROM dish_ingredients WHERE "dishId" = ANY($1::uuid[])', [cleanup.dishes]);
      await db.query('DELETE FROM dishes WHERE id = ANY($1::uuid[])', [cleanup.dishes]);
    }

    if (cleanup.ingredients.length) {
      await db.query('DELETE FROM ingredients WHERE id = ANY($1::uuid[])', [cleanup.ingredients]);
    }

    if (cleanup.products.length) {
      await db.query('DELETE FROM products WHERE id = ANY($1::uuid[])', [cleanup.products]);
    }

    await db.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [tenantIds]);
  } finally {
    await db.end();
  }
}

async function main() {
  const tenantA = await register('a', '10.70.1.1');
  const tenantB = await register('b', '10.70.1.2');

  const productA = await createShopProduct(tenantA, 'A', requests);
  const productB = await createShopProduct(tenantB, 'B', requests);
  const dishA = await createKdsFixture(tenantA, 'A');
  const dishB = await createKdsFixture(tenantB, 'B');

  const results = [
    ...(await runShop(tenantA, tenantB, productA, productB)),
    ...(await runBooking(tenantA, tenantB)),
    ...(await runKds(tenantA, tenantB, dishA, dishB)),
  ];

  const integrity = await databaseIntegrity(
    tenantA,
    tenantB,
    productA,
    productB,
  );

  if (integrity.mismatches !== 0) {
    throw new Error(`Intégrité cross-tenant échouée: ${JSON.stringify(integrity)}`);
  }

  console.log(
    JSON.stringify(
      {
        event: 'load.multi_tenant.completed',
        tenants: [tenantA.tenant.id, tenantB.tenant.id],
        requests,
        concurrency,
        results,
        integrity,
        timestamp: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(
      JSON.stringify({
        event: 'load.multi_tenant.failed',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await cleanupDatabase();
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'load.multi_tenant.cleanup_failed',
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  });
