/* eslint-disable no-console */
const { createServer } = require('node:http');
const { spawn } = require('node:child_process');
const { Client } = require('pg');

const APP_PORT = Number(process.env.OTEL_VERIFY_APP_PORT || 3101);
const WORKER_PORT = Number(process.env.OTEL_VERIFY_WORKER_PORT || 3102);
const COLLECTOR_PORT = Number(process.env.OTEL_VERIFY_COLLECTOR_PORT || 4319);
const BASE_URL = `http://127.0.0.1:${APP_PORT}`;
const WORKER_URL = `http://127.0.0.1:${WORKER_PORT}`;
const payloads = [];
let collectorError = null;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function commonEnv(serviceName) {
  return {
    ...process.env,
    NODE_ENV: 'test',
    POSTGRES_HOST: process.env.POSTGRES_HOST || '127.0.0.1',
    POSTGRES_PORT: process.env.POSTGRES_PORT || '55432',
    POSTGRES_USERNAME: process.env.POSTGRES_USERNAME || 'gymsoins',
    POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD || 'gymsoins',
    POSTGRES_RUNTIME_USERNAME:
      process.env.APP_DB_USER || 'gymsoins_app',
    POSTGRES_RUNTIME_PASSWORD:
      process.env.APP_DB_PASSWORD ||
      process.env.POSTGRES_RUNTIME_PASSWORD ||
      '',
    WORKER_DB_USERNAME: process.env.WORKER_DB_USER || 'gymsoins_worker',
    WORKER_DB_PASSWORD: process.env.WORKER_DB_PASSWORD || '',
    POSTGRES_DATABASE: process.env.POSTGRES_DATABASE || 'gymsoins_test',
    JWT_SECRET: process.env.JWT_SECRET || 'dev-jwt-secret-change-me',
    LICENSE_SECRET:
      process.env.LICENSE_SECRET || 'dev-license-secret-change-me',
    LICENSE_DEV_MODE: 'true',
    RETENTION_PURGE_ENABLED: 'false',
    OTEL_ENABLED: 'true',
    OTEL_SERVICE_NAME: serviceName,
    OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${COLLECTOR_PORT}`,
    OTEL_BSP_SCHEDULE_DELAY: '500',
    OBSERVABILITY_LOG_ENABLED: 'false',
  };
}

async function waitForUrl(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {
      // pas encore prêt
    }
    await wait(200);
  }

  throw new Error(`Service non disponible: ${url}`);
}

function spawnService(script, env, label) {
  const child = spawn(process.execPath, [script], {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  child.stdout.on('data', () => undefined);
  child.__label = label;
  child.__stderr = () => stderr;
  return child;
}

function extractSpans(body) {
  const resourceSpans = body.resourceSpans || [];
  const spans = [];

  for (const resourceSpan of resourceSpans) {
    const resource = resourceSpan.resource || {};
    const serviceName = (resource.attributes || []).find(
      (attribute) => attribute.key === 'service.name',
    )?.value?.stringValue;

    for (const scopeSpan of resourceSpan.scopeSpans || []) {
      for (const span of scopeSpan.spans || []) {
        spans.push({
          serviceName,
          name: span.name,
          traceId: span.traceId,
          spanId: span.spanId,
          kind: span.kind,
        });
      }
    }
  }

  return spans;
}

async function cleanupDatabase(productId, saleId) {
  const client = new Client({
    host: process.env.POSTGRES_HOST || '127.0.0.1',
    port: Number(process.env.POSTGRES_PORT || 55432),
    user: process.env.POSTGRES_USERNAME || 'gymsoins',
    password: process.env.POSTGRES_PASSWORD || 'gymsoins',
    database: process.env.POSTGRES_DATABASE || 'gymsoins_test',
  });

  await client.connect();

  try {
    if (saleId) {
      await client.query('DELETE FROM sale_items WHERE "saleId" = $1', [saleId]);
      await client.query('DELETE FROM sales WHERE id = $1', [saleId]);
      await client.query('DELETE FROM outbox_events WHERE "aggregateId" = $1', [
        saleId,
      ]);
    }
    if (productId) {
      await client.query('DELETE FROM products WHERE id = $1', [productId]);
    }
  } finally {
    await client.end();
  }
}

async function main() {
  const collector = createServer((request, response) => {
    let body = '';

    request.on('data', (chunk) => {
      body += chunk.toString('utf8');
    });

    request.on('end', () => {
      const contentType = request.headers['content-type'] || '';

      try {
        payloads.push({
          path: request.url,
          contentType,
          body: JSON.parse(body),
        });
      } catch (error) {
        collectorError = `Payload OTLP non JSON (${contentType}): ${error.message}`;
      }

      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{}');
    });
  });

  await new Promise((resolve, reject) => {
    collector.once('error', reject);
    collector.listen(COLLECTOR_PORT, '127.0.0.1', resolve);
  });

  const app = spawnService(
    'dist/main.js',
    {
      ...commonEnv('gymsoins-otel-proof'),
      PORT: String(APP_PORT),
      OUTBOX_WORKER_ENABLED: 'false',
    },
    'api',
  );

  const worker = spawnService(
    'dist/worker.js',
    {
      ...commonEnv('gymsoins-otel-worker'),
      OUTBOX_WORKER_ENABLED: 'true',
      WORKER_HEALTH_HOST: '127.0.0.1',
      WORKER_HEALTH_PORT: String(WORKER_PORT),
    },
    'worker',
  );

  let productId = null;
  let saleId = null;

  try {
    await waitForUrl(`${BASE_URL}/api/v1/license/status`);
    await waitForUrl(`${WORKER_URL}/health`);

    const login = await fetch(`${BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: process.env.LOAD_EMAIL || 'admin.e2e@gymsoins.local',
        password: process.env.LOAD_PASSWORD || 'AdminE2E123!',
      }),
    });

    if (login.status !== 200) {
      throw new Error(`Login OTel échoué: HTTP ${login.status}`);
    }

    const loginBody = await login.json();
    const authHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${loginBody.access_token}`,
    };
    const suffix = Date.now();

    const productResponse = await fetch(`${BASE_URL}/api/v1/shop`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: `OTel product ${suffix}`,
        sku: `OTEL-${suffix}`,
        price: 10,
        stockQuantity: 1,
        category: 'BOISSON',
        isActive: true,
      }),
    });

    if (productResponse.status !== 201) {
      throw new Error(`Création produit OTel: HTTP ${productResponse.status}`);
    }

    const product = await productResponse.json();
    productId = product.id;

    const saleResponse = await fetch(`${BASE_URL}/api/v1/shop/sales/process`, {
      method: 'POST',
      headers: {
        ...authHeaders,
        'Idempotency-Key': `otel-sale-${suffix}`,
      },
      body: JSON.stringify({
        items: [{ productId, quantity: 1 }],
        paymentMethod: 'ESPECES',
      }),
    });

    if (saleResponse.status !== 201) {
      throw new Error(`Création vente OTel: HTTP ${saleResponse.status}`);
    }

    const sale = await saleResponse.json();
    saleId = sale.saleId;

    const deadline = Date.now() + 15_000;
    let spans = [];

    while (Date.now() < deadline) {
      spans = payloads.flatMap((payload) => extractSpans(payload.body));

      if (spans.some((span) => span.name === 'outbox.process')) {
        break;
      }

      await wait(250);
    }

    if (collectorError) {
      throw new Error(collectorError);
    }

    if (payloads.length === 0) {
      throw new Error('Aucun export OTLP reçu par le collecteur');
    }

    const serviceNames = [...new Set(spans.map((span) => span.serviceName))];
    const spanNames = [...new Set(spans.map((span) => span.name))];
    const traceIds = [
      ...new Set(spans.map((span) => span.traceId).filter(Boolean)),
    ];

    if (!serviceNames.includes('gymsoins-otel-proof')) {
      throw new Error(
        `service.name API OTel absent: ${JSON.stringify(serviceNames)}`,
      );
    }

    if (!serviceNames.includes('gymsoins-otel-worker')) {
      throw new Error(
        `service.name worker OTel absent: ${JSON.stringify(serviceNames)}`,
      );
    }

    if (!spanNames.some((name) => /POST|login|http/i.test(name))) {
      throw new Error(`Aucun span HTTP trouvé: ${JSON.stringify(spanNames)}`);
    }

    if (
      !spanNames.some((name) => /pg|postgres|SELECT|query/i.test(name))
    ) {
      throw new Error(
        `Aucun span PostgreSQL trouvé: ${JSON.stringify(spanNames)}`,
      );
    }

    const appendSpan = spans.find((span) => span.name === 'outbox.append');
    const processSpan = spans.find((span) => span.name === 'outbox.process');

    if (!appendSpan || !processSpan) {
      throw new Error(
        `Spans Outbox manquants: ${JSON.stringify({
          append: Boolean(appendSpan),
          process: Boolean(processSpan),
          spanNames,
        })}`,
      );
    }

    if (appendSpan.traceId !== processSpan.traceId) {
      throw new Error(
        `Corrélation Outbox invalide: append=${appendSpan.traceId} process=${processSpan.traceId}`,
      );
    }

    console.log(
      JSON.stringify(
        {
          event: 'otel.verified',
          collectorPort: COLLECTOR_PORT,
          exports: payloads.length,
          services: serviceNames,
          spanCount: spans.length,
          spanNames,
          traceIds,
          outboxTraceId: appendSpan.traceId,
          outboxCorrelated: true,
        },
        null,
        2,
      ),
    );
  } finally {
    for (const child of [app, worker]) {
      child.kill('SIGTERM');
    }
    await new Promise((resolve) => {
      let remaining = 2;
      const done = () => {
        remaining -= 1;
        if (remaining <= 0) resolve();
      };
      for (const child of [app, worker]) {
        child.once('exit', done);
      }
      setTimeout(resolve, 6_000);
    });

    await cleanupDatabase(productId, saleId);
    await new Promise((resolve) => collector.close(resolve));

    for (const child of [app, worker]) {
      if (child.__stderr().trim()) {
        process.stderr.write(
          `[${child.__label}] ${child.__stderr().trim()}\n`,
        );
      }
    }
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      event: 'otel.verify_failed',
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
