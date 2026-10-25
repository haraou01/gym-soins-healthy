const baseUrl = (
  process.env.SMOKE_API_URL || 'http://127.0.0.1:3001/api/v1'
).replace(/\/$/, '');
const email = process.env.SMOKE_EMAIL;
const password = process.env.SMOKE_PASSWORD;

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${path} → HTTP ${response.status}: ${body.slice(0, 500)}`);
  }

  return response;
}

async function main() {
  if (!email || !password) {
    throw new Error('SMOKE_EMAIL et SMOKE_PASSWORD sont obligatoires.');
  }

  const license = await request('/license/features');
  const login = await request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const auth = await login.json();
  const headers = { Authorization: `Bearer ${auth.access_token}` };

  const [products, dishes, equipments, outbox] = await Promise.all([
    request('/shop', { headers }),
    request('/healthy-food/dishes', { headers }),
    request('/maintenance/equipments', { headers }),
    request('/outbox/stats', { headers }),
  ]);

  const summary = {
    event: 'restore.smoke.completed',
    licenseModules: (await license.json()).modules,
    products: (await products.json()).length,
    dishes: (await dishes.json()).length,
    equipments: (await equipments.json()).length,
    outbox: await outbox.json(),
    timestamp: new Date().toISOString(),
  };

  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({
      event: 'restore.smoke.failed',
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    })}\n`,
  );
  process.exit(1);
});
