/* eslint-disable no-console */
const { chromium } = require('playwright-core');
const { Client } = require('pg');

const API = (
  process.env.UI_VERIFY_BASE_URL || 'http://127.0.0.1:3000/api/v1'
).replace(/\/$/, '');
const FRONTEND = (
  process.env.UI_VERIFY_FRONTEND_URL || 'http://localhost:5173'
).replace(/\/$/, '');
const chromePath =
  process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const suffix = Date.now();
const password = 'UiTenant123!';

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, options);
  const text = await response.text();
  let body = null;

  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (response.status >= 400) {
    throw new Error(`${path}: HTTP ${response.status} ${text}`);
  }

  return body;
}

async function register(name, ip) {
  return api('/auth/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': ip,
    },
    body: JSON.stringify({
      email: `${name}-${suffix}@gymsoins.local`,
      password,
      username: name,
      tenantName: `UI verify ${name} ${suffix}`,
    }),
  });
}

async function setupMultiTenantFixture() {
  const a = await register('ui-multi-a', '10.60.1.1');
  const b = await register('ui-multi-b', '10.60.1.2');

  const db = new Client({
    host: process.env.POSTGRES_HOST || '127.0.0.1',
    port: Number(process.env.POSTGRES_PORT || 55432),
    user: process.env.POSTGRES_USERNAME || 'gymsoins',
    password: process.env.POSTGRES_PASSWORD || 'gymsoins',
    database: process.env.POSTGRES_DATABASE || 'gymsoins_test',
  });
  await db.connect();

  try {
    const role = await db.query(
      "SELECT id FROM roles WHERE name = 'RECEPTIONIST'",
    );
    await db.query(
      `INSERT INTO tenant_memberships ("tenantId", "userId", "roleId", status)
       VALUES ($1, $2, $3, 'ACTIVE')
       ON CONFLICT ("tenantId", "userId") DO NOTHING`,
      [b.tenant.id, a.user.id, role.rows[0].id],
    );
  } finally {
    await db.end();
  }

  const auth = (tenant) => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${tenant.access_token}`,
  });

  const productA = await api('/shop', {
    method: 'POST',
    headers: auth(a),
    body: JSON.stringify({
      name: `UI Product A ${suffix}`,
      sku: `UI-A-${suffix}`,
      price: 11,
      stockQuantity: 5,
      category: 'BOISSON',
      isActive: true,
    }),
  });

  const productB = await api('/shop', {
    method: 'POST',
    headers: auth(b),
    body: JSON.stringify({
      name: `UI Product B ${suffix}`,
      sku: `UI-B-${suffix}`,
      price: 22,
      stockQuantity: 5,
      category: 'BOISSON',
      isActive: true,
    }),
  });

  return {
    a,
    b,
    productA: productA.name,
    productB: productB.name,
  };
}

async function main() {
  const fixture = await setupMultiTenantFixture();
  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  const result = {
    event: 'ui.tenant.verified',
    registration: false,
    singleMembership: false,
    tenantSelection: false,
    tenantSwitch: false,
    tokenReplaced: false,
    dataIsolation: false,
    revokedMembership: false,
    fallbackPolling: false,
    consoleErrors,
  };

  try {
    // 1. Inscription self-service du premier admin.
    await page.goto(`${FRONTEND}/login`, { waitUntil: 'networkidle' });
    await page.getByRole('button', {
      name: 'Créer un nouvel établissement',
    }).click();

    const registrationTenant = `UI registered ${suffix}`;
    await page.locator('#login-username').fill(`ui-register-${suffix}`);
    await page.locator('#login-tenant-name').fill(registrationTenant);
    await page
      .locator('#login-email')
      .fill(`ui-register-${suffix}@gymsoins.local`);
    await page.locator('#login-password').fill(password);
    await page.getByRole('button', {
      name: 'Créer l’établissement',
    }).click();
    await page.waitForURL('**/dashboard', { timeout: 15_000 });
    await page.getByText(registrationTenant).first().waitFor();
    result.registration = true;

    // 2. Login d'un utilisateur avec plusieurs adhésions.
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${FRONTEND}/login`, { waitUntil: 'networkidle' });
    await page.locator('#login-email').fill(fixture.a.user.email);
    await page.locator('#login-password').fill(password);
    await page.getByRole('button', { name: 'Se connecter' }).click();

    const tenantSelect = page.locator('#login-tenant');
    await tenantSelect.waitFor({ timeout: 10_000 });
    result.tenantSelection = true;
    await tenantSelect.selectOption(fixture.a.tenant.id);
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await page.waitForURL('**/dashboard', { timeout: 15_000 });
    result.singleMembership = true;

    const tokenBefore = await page.evaluate(() =>
      localStorage.getItem('gymsoins_token'),
    );

    // 3. Données du tenant A uniquement.
    await page.goto(`${FRONTEND}/shop`, { waitUntil: 'networkidle' });
    await page.getByText(fixture.productA).first().waitFor({ timeout: 10_000 });
    result.dataIsolation =
      (await page.getByText(fixture.productB).count()) === 0;

    // 4. Changement de tenant depuis la sidebar.
    const switchSelect = page.locator(
      'select[aria-label="Changer d’établissement"]',
    );
    await switchSelect.waitFor({ timeout: 10_000 });
    await switchSelect.selectOption(fixture.b.tenant.id);
    await page.waitForTimeout(1_000);
    await page.goto(`${FRONTEND}/shop`, { waitUntil: 'networkidle' });
    await page.getByText(fixture.productB).first().waitFor({ timeout: 10_000 });

    const tokenAfter = await page.evaluate(() =>
      localStorage.getItem('gymsoins_token'),
    );
    result.tokenReplaced = Boolean(tokenBefore && tokenAfter && tokenBefore !== tokenAfter);
    result.tenantSwitch = true;
    result.dataIsolation =
      result.dataIsolation &&
      (await page.getByText(fixture.productA).count()) === 0;

    // 5. Révocation de l'adhésion courante : la prochaine requête API doit
    //    renvoyer 401 et l'interface doit revenir au login.
    const db = new Client({
      host: process.env.POSTGRES_HOST || '127.0.0.1',
      port: Number(process.env.POSTGRES_PORT || 55432),
      user: process.env.POSTGRES_USERNAME || 'gymsoins',
      password: process.env.POSTGRES_PASSWORD || 'gymsoins',
      database: process.env.POSTGRES_DATABASE || 'gymsoins_test',
    });
    await db.connect();
    try {
      await db.query(
        `UPDATE tenant_memberships
         SET status = 'SUSPENDED'
         WHERE "tenantId" = $1 AND "userId" = $2`,
        [fixture.b.tenant.id, fixture.a.user.id],
      );
    } finally {
      await db.end();
    }

    await page.goto(`${FRONTEND}/shop`, { waitUntil: 'networkidle' });
    await page.waitForURL('**/login', { timeout: 15_000 });
    result.revokedMembership = true;

    // 6. Fallback polling navigateur : le flux SSE est bloqué, l'interface
    //    doit rester utilisable et annoncer le polling REST.
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${FRONTEND}/login`, { waitUntil: 'networkidle' });
    await page.locator('#login-email').fill(fixture.a.user.email);
    await page.locator('#login-password').fill(password);
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await page.waitForURL('**/dashboard', { timeout: 15_000 });

    await page.route('**/healthy-food/kds/stream*', (route) => route.abort());
    await page.goto(`${FRONTEND}/healthy-food`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /Cuisine \(KDS\)/ }).click();
    await page
      .getByText('Commandes actives · fallback polling 10 s.')
      .waitFor({ timeout: 15_000 });
    result.fallbackPolling = true;

    if (
      !result.registration ||
      !result.tenantSelection ||
      !result.tokenReplaced ||
      !result.dataIsolation ||
      !result.revokedMembership ||
      !result.fallbackPolling
    ) {
      throw new Error(`UI verification incomplete: ${JSON.stringify(result)}`);
    }

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      event: 'ui.tenant.failed',
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
