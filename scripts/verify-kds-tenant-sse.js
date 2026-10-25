/* eslint-disable no-console */
const { createHash } = require('node:crypto');
const { Client } = require('pg');

const API = (
  process.env.SSE_VERIFY_BASE_URL || 'http://127.0.0.1:3000/api/v1'
).replace(/\/$/, '');
const suffix = Date.now();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, options);
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
  const response = await api('/auth/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': ip,
    },
    body: JSON.stringify({
      email: `${name}-${suffix}@gymsoins.local`,
      password: 'TenantSseVerify123!',
      username: name,
      tenantName: `SSE verify ${name} ${suffix}`,
    }),
  });

  if (response.status !== 201) {
    throw new Error(`Register ${name}: ${JSON.stringify(response.body)}`);
  }

  return response.body;
}

async function openSse(ticket) {
  const controller = new AbortController();
  const response = await fetch(
    `${API}/healthy-food/kds/stream?ticket=${encodeURIComponent(ticket)}`,
    { signal: controller.signal },
  );

  if (!response.ok) {
    throw new Error(`SSE HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events = [];

  const done = (async () => {
    try {
      while (true) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });
        let index;

        while ((index = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const line = block
            .split('\n')
            .find((candidate) => candidate.startsWith('data: '));

          if (line) {
            try {
              events.push(JSON.parse(line.slice(6)));
            } catch {
              // ignore non-JSON keepalive
            }
          }
        }
      }
    } catch (error) {
      if (error.name !== 'AbortError') throw error;
    }
  })();

  return { controller, events, done };
}

async function waitEvent(client, type, timeout = 10_000) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const event = [...client.events]
      .reverse()
      .find((candidate) => candidate.eventType === type);

    if (event) return event;
    await sleep(100);
  }

  throw new Error(
    `Timeout ${type}; reçu: ${client.events.map((event) => event.eventType).join(',')}`,
  );
}

async function expireTicket(token) {
  const client = new Client({
    host: process.env.POSTGRES_HOST || '127.0.0.1',
    port: Number(process.env.POSTGRES_PORT || 55432),
    user: process.env.POSTGRES_USERNAME || 'gymsoins',
    password: process.env.POSTGRES_PASSWORD || 'gymsoins',
    database: process.env.POSTGRES_DATABASE || 'gymsoins_test',
  });
  await client.connect();
  try {
    await client.query(
      `UPDATE kds_stream_tickets
       SET "expiresAt" = NOW() - INTERVAL '1 second'
       WHERE "tokenHash" = $1`,
      [createHash('sha256').update(token).digest('hex')],
    );
  } finally {
    await client.end();
  }
}

async function cleanup({ tenantIds, orderIds, dishIds, ingredientIds }) {
  const client = new Client({
    host: process.env.POSTGRES_HOST || '127.0.0.1',
    port: Number(process.env.POSTGRES_PORT || 55432),
    user: process.env.POSTGRES_USERNAME || 'gymsoins',
    password: process.env.POSTGRES_PASSWORD || 'gymsoins',
    database: process.env.POSTGRES_DATABASE || 'gymsoins_test',
  });

  await client.connect();

  try {
    if (orderIds.length > 0) {
      await client.query(
        'DELETE FROM outbox_events WHERE "aggregateId" = ANY($1::text[])',
        [orderIds],
      );
      await client.query(
        'DELETE FROM kitchen_orders WHERE id = ANY($1::uuid[])',
        [orderIds],
      );
    }

    if (dishIds.length > 0) {
      await client.query(
        'DELETE FROM dish_ingredients WHERE "dishId" = ANY($1::uuid[])',
        [dishIds],
      );
      await client.query('DELETE FROM dishes WHERE id = ANY($1::uuid[])', [
        dishIds,
      ]);
    }

    if (ingredientIds.length > 0) {
      await client.query(
        'DELETE FROM ingredients WHERE id = ANY($1::uuid[])',
        [ingredientIds],
      );
    }

    if (tenantIds.length > 0) {
      await client.query(
        'DELETE FROM outbox_events WHERE "tenantId" = ANY($1::uuid[])',
        [tenantIds],
      );
      await client.query(
        'DELETE FROM idempotency_keys WHERE "tenantId" = ANY($1::uuid[])',
        [tenantIds],
      );
      await client.query(
        'DELETE FROM kds_stream_tickets WHERE "tenantId" = ANY($1::uuid[])',
        [tenantIds],
      );
      await client.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [
        tenantIds,
      ]);
    }
  } finally {
    await client.end();
  }
}

async function main() {
  let tenantA;
  let tenantB;
  let clientA;
  let clientB;
  const orderIds = [];
  const dishIds = [];
  const ingredientIds = [];

  try {
    tenantA = await register('sse-verify-a', '10.30.30.1');
    tenantB = await register('sse-verify-b', '10.30.30.2');

    const auth = (tenant) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tenant.access_token}`,
    });

    const ticket = async (tenant) => {
      const response = await api('/healthy-food/kds/stream-ticket', {
        method: 'POST',
        headers: auth(tenant),
      });

      if (response.status !== 200) {
        throw new Error(`Ticket: ${JSON.stringify(response.body)}`);
      }

      return response.body.ticket;
    };

    const makeFood = async (tenant) => {
      const ingredient = await api('/healthy-food/ingredients', {
        method: 'POST',
        headers: auth(tenant),
        body: JSON.stringify({
          name: `SSE verify ingredient ${suffix} ${tenant.tenant.id}`,
          unit: 'UNITE',
          stockQuantity: 5,
          alertThreshold: 0,
        }),
      });

      if (ingredient.status !== 201) {
        throw new Error(`Ingredient: ${JSON.stringify(ingredient.body)}`);
      }

      ingredientIds.push(ingredient.body.id);

      const dish = await api('/healthy-food/dishes', {
        method: 'POST',
        headers: auth(tenant),
        body: JSON.stringify({
          name: `SSE verify dish ${suffix} ${tenant.tenant.id}`,
          price: 9,
          category: 'PLAT',
          isAvailable: true,
          type: 'SUR_COMMANDE',
        }),
      });

      if (dish.status !== 201) {
        throw new Error(`Dish: ${JSON.stringify(dish.body)}`);
      }

      dishIds.push(dish.body.id);

      await api(`/healthy-food/dishes/${dish.body.id}/ingredients`, {
        method: 'POST',
        headers: auth(tenant),
        body: JSON.stringify({
          ingredientId: ingredient.body.id,
          quantityNeeded: 1,
        }),
      });

      return dish.body.id;
    };

    const dishA = await makeFood(tenantA);
    const dishB = await makeFood(tenantB);

    const ticketA = await ticket(tenantA);
    const ticketB = await ticket(tenantB);
    clientA = await openSse(ticketA);
    clientB = await openSse(ticketB);
    await waitEvent(clientA, 'resync');
    await waitEvent(clientB, 'resync');

    const createOrder = async (tenant, dishId, index) => {
      const response = await api('/healthy-food/orders', {
        method: 'POST',
        headers: {
          ...auth(tenant),
          'Idempotency-Key': `sse-verify-${suffix}-${index}`,
        },
        body: JSON.stringify({
          clientId: `sse-verify-client-${suffix}-${index}`,
          type: 'SUR_PLACE',
          items: [{ dishId, quantity: 1 }],
        }),
      });

      if (response.status !== 201) {
        throw new Error(`Order: ${JSON.stringify(response.body)}`);
      }

      orderIds.push(response.body.id);
      return response.body.id;
    };

    const orderA = await createOrder(tenantA, dishA, 1);
    const eventA = await waitEvent(clientA, 'kitchen.order.created');
    await sleep(700);
    const bReceivedA = clientB.events.some(
      (event) =>
        event.eventType === 'kitchen.order.created' &&
        event.payload?.orderId === orderA,
    );

    const orderB = await createOrder(tenantB, dishB, 2);
    const eventB = await waitEvent(clientB, 'kitchen.order.created');
    await sleep(700);
    const aReceivedB = clientA.events.some(
      (event) =>
        event.eventType === 'kitchen.order.created' &&
        event.payload?.orderId === orderB,
    );

    // Un ancien ticket déjà consommé ne doit pas être réutilisable.
    const reused = await fetch(
      `${API}/healthy-food/kds/stream?ticket=${encodeURIComponent(ticketA)}`,
    );
    const reuseRejected = reused.status === 401;

    // Ticket expiré : refus explicite.
    const expiringTicket = await ticket(tenantA);
    await expireTicket(expiringTicket);
    const expired = await fetch(
      `${API}/healthy-food/kds/stream?ticket=${encodeURIComponent(expiringTicket)}`,
    );
    const expiredRejected = expired.status === 401;

    // Fallback REST : mêmes garanties d'isolation que SSE.
    const listA = await api('/healthy-food/orders', {
      headers: auth(tenantA),
    });
    const listB = await api('/healthy-food/orders', {
      headers: auth(tenantB),
    });
    const pollingIsolation =
      listA.status === 200 &&
      listB.status === 200 &&
      !listA.body.some((order) => order.id === orderB) &&
      !listB.body.some((order) => order.id === orderA);

    // Reconnexion après fermeture, nouveau ticket et resynchronisation.
    clientA.controller.abort();
    clientB.controller.abort();
    await sleep(300);

    const reconnectA = await openSse(await ticket(tenantA));
    const reconnectB = await openSse(await ticket(tenantB));
    await waitEvent(reconnectA, 'resync');
    await waitEvent(reconnectB, 'resync');

    const orderA2 = await createOrder(tenantA, dishA, 3);
    const eventA2 = await waitEvent(reconnectA, 'kitchen.order.created');
    await sleep(600);
    const reconnectBLeak = reconnectB.events.some(
      (event) =>
        event.eventType === 'kitchen.order.created' &&
        event.payload?.orderId === orderA2,
    );

    const orderB2 = await createOrder(tenantB, dishB, 4);
    const eventB2 = await waitEvent(reconnectB, 'kitchen.order.created');
    await sleep(600);
    const reconnectALeak = reconnectA.events.some(
      (event) =>
        event.eventType === 'kitchen.order.created' &&
        event.payload?.orderId === orderB2,
    );

    const result = {
      event: 'kds.sse.tenant_isolation.verified',
      tenantA: tenantA.tenant.id,
      tenantB: tenantB.tenant.id,
      orderA,
      orderB,
      aReceivedA: eventA.payload?.orderId === orderA,
      bReceivedA,
      bReceivedB: eventB.payload?.orderId === orderB,
      aReceivedB,
      reuseRejected,
      expiredRejected,
      pollingIsolation,
      reconnect: {
        aReceivedA: eventA2.payload?.orderId === orderA2,
        bReceivedB: eventB2.payload?.orderId === orderB2,
        aReceivedB: reconnectALeak,
        bReceivedA: reconnectBLeak,
      },
      traceIds: [eventA.traceId, eventB.traceId],
    };

    if (
      bReceivedA ||
      aReceivedB ||
      !result.aReceivedA ||
      !result.bReceivedB ||
      !reuseRejected ||
      !expiredRejected ||
      !pollingIsolation ||
      !result.reconnect.aReceivedA ||
      !result.reconnect.bReceivedB ||
      result.reconnect.aReceivedB ||
      result.reconnect.bReceivedA
    ) {
      throw new Error(`Isolation SSE échouée: ${JSON.stringify(result)}`);
    }

    reconnectA.controller.abort();
    reconnectB.controller.abort();
    await sleep(200);

    console.log(JSON.stringify(result, null, 2));
  } finally {
    clientA?.controller.abort();
    clientB?.controller.abort();
    await sleep(300);
    await cleanup({
      tenantIds: [tenantA?.tenant?.id, tenantB?.tenant?.id].filter(Boolean),
      orderIds,
      dishIds,
      ingredientIds,
    });
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      event: 'kds.sse.tenant_isolation.failed',
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
