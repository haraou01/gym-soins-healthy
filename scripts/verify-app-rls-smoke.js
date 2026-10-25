/* eslint-disable no-console */
const API = (
  process.env.RLS_SMOKE_BASE_URL || 'http://127.0.0.1:3000/api/v1'
).replace(/\/$/, '');
const suffix = Date.now();

async function request(token, path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body = null;

  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${path}: HTTP ${response.status} ${text}`);
  }

  return body;
}

async function main() {
  const register = await request(null, '/auth/register', {
    method: 'POST',
    headers: { 'X-Forwarded-For': '10.80.1.1' },
    body: JSON.stringify({
      email: `rls-smoke-${suffix}@gymsoins.local`,
      password: 'RlsSmoke123!',
      username: `rls-smoke-${suffix}`,
      tenantName: `RLS smoke ${suffix}`,
    }),
  });

  const token = register.access_token;
  const clientId = `rls-smoke-client-${suffix}`;
  const now = new Date();
  const checks = {};

  await request(token, '/gym/subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      clientId,
      type: 'MENSUEL',
      startDate: new Date(now.getTime() - 3_600_000).toISOString(),
      endDate: new Date(now.getTime() + 86_400_000).toISOString(),
    }),
  });
  checks.gymSubscription = true;

  const checkIn = await request(token, '/gym/check-in', {
    method: 'POST',
    body: JSON.stringify({ clientId, method: 'QR_CODE' }),
  });
  checks.gymCheckIn = checkIn.granted === true;

  const care = await request(token, '/care/services', {
    method: 'POST',
    body: JSON.stringify({
      title: `RLS smoke care ${suffix}`,
      durationMinutes: 45,
      price: 40,
      type: 'PACK',
    }),
  });
  await request(token, '/care/packages/assign', {
    method: 'POST',
    body: JSON.stringify({
      clientId,
      careServiceId: care.id,
      totalSessions: 1,
    }),
  });
  await request(token, '/care/sessions/consume', {
    method: 'POST',
    body: JSON.stringify({
      clientId,
      careServiceId: care.id,
      therapistId: `rls-smoke-therapist-${suffix}`,
      timestamp: new Date().toISOString(),
    }),
  });
  checks.care = true;

  await request(token, '/bookings', {
    method: 'POST',
    body: JSON.stringify({
      clientId,
      resourceType: 'EQUIPMENT',
      resourceId: require('node:crypto').randomUUID(),
      practitionerOrCoachId: `rls-smoke-coach-${suffix}`,
      startTime: new Date(now.getTime() + 7_200_000).toISOString(),
      endTime: new Date(now.getTime() + 10_800_000).toISOString(),
    }),
  });
  checks.booking = true;

  const equipment = await request(token, '/maintenance/equipments', {
    method: 'POST',
    body: JSON.stringify({
      name: `RLS smoke equipment ${suffix}`,
      serialNumber: `RLS-SMOKE-${suffix}`,
      category: 'CARDIO',
      location: 'Salle RLS',
    }),
  });
  await request(token, '/maintenance/tickets', {
    method: 'POST',
    body: JSON.stringify({
      equipmentId: equipment.id,
      reportedByUserId: 'rls-smoke-user',
      description: 'Smoke RLS',
    }),
  });
  checks.maintenance = true;

  const product = await request(token, '/shop', {
    method: 'POST',
    body: JSON.stringify({
      name: `RLS smoke product ${suffix}`,
      sku: `RLS-SMOKE-${suffix}`,
      price: 15,
      stockQuantity: 5,
      category: 'BOISSON',
      isActive: true,
    }),
  });
  await request(token, '/shop/sales/process', {
    method: 'POST',
    headers: { 'Idempotency-Key': `rls-smoke-sale-${suffix}` },
    body: JSON.stringify({
      clientId,
      items: [{ productId: product.id, quantity: 1 }],
      paymentMethod: 'ESPECES',
    }),
  });
  const loyalty = await request(token, `/loyalty/balance/${clientId}`);
  checks.shopLoyalty = loyalty.pointsBalance >= 1;

  const ingredient = await request(token, '/healthy-food/ingredients', {
    method: 'POST',
    body: JSON.stringify({
      name: `RLS smoke ingredient ${suffix}`,
      unit: 'UNITE',
      stockQuantity: 3,
      alertThreshold: 0,
    }),
  });
  const dish = await request(token, '/healthy-food/dishes', {
    method: 'POST',
    body: JSON.stringify({
      name: `RLS smoke dish ${suffix}`,
      price: 9,
      category: 'PLAT',
      isAvailable: true,
      type: 'SUR_COMMANDE',
    }),
  });
  await request(token, `/healthy-food/dishes/${dish.id}/ingredients`, {
    method: 'POST',
    body: JSON.stringify({ ingredientId: ingredient.id, quantityNeeded: 1 }),
  });
  const order = await request(token, '/healthy-food/orders', {
    method: 'POST',
    body: JSON.stringify({
      clientId,
      type: 'SUR_PLACE',
      items: [{ dishId: dish.id, quantity: 1 }],
    }),
  });
  await request(token, `/healthy-food/orders/${order.id}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status: 'EN_PREPARATION' }),
  });
  checks.healthyFood = true;

  const outbox = await request(token, '/outbox/stats');
  checks.outbox = ['PENDING', 'PROCESSING', 'PROCESSED', 'FAILED'].every(
    (status) => typeof outbox[status] === 'number',
  );

  const failed = Object.entries(checks).filter(([, value]) => value !== true);
  if (failed.length > 0) {
    throw new Error(`RLS smoke échoué: ${JSON.stringify(checks)}`);
  }

  console.log(
    JSON.stringify(
      {
        event: 'app.rls.smoke.verified',
        tenantId: register.tenant.id,
        checks,
        outbox,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      event: 'app.rls.smoke.failed',
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
