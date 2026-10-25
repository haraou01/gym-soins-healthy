import { createHash, createHmac, randomUUID } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { OutboxService } from '../src/core/outbox';
import { runWithTenantContext } from '../src/core/tenant';
import { AuthAuditService } from '../src/modules/auth/auth-audit.service';
import { BookingService } from '../src/modules/booking/services/booking.service';
import { KdsEventsService } from '../src/modules/healthy_food/services/kds-events.service';
import { KdsStreamTicketService } from '../src/modules/healthy_food/services/kds-stream-ticket.service';
import {
  getTestDatabaseSettings,
  resetTestDatabase,
  TEST_ADMIN_EMAIL,
  TEST_ADMIN_PASSWORD,
  TEST_RECEPTIONIST_EMAIL,
  TEST_TENANT_ID,
  TEST_JWT_SECRET,
  TEST_LICENSE_SECRET,
  waitForDatabase,
} from './utils/test-database';

const TEST_HARDWARE_ID = 'E2E-HARDWARE-0001';
const TEST_CLIENT_ID = 'e2e-client-0001';
const ALL_MODULES = [
  'gym',
  'care',
  'shop',
  'healthy_food',
  'maintenance',
  'booking',
  'loyalty',
];

/** Construit une clé de licence signée HMAC-SHA256, comme le ferait l'éditeur. */
function buildLicenseKey(
  scope: string[] = ['all'],
  hardwareId: string = TEST_HARDWARE_ID,
): string {
  const payload = {
    licenseId: 'E2E-LICENSE-0001',
    customer: 'Validation E2E',
    hardwareId,
    scope,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };

  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', TEST_LICENSE_SECRET)
    .update(encodedPayload)
    .digest('hex');

  return `${encodedPayload}.${signature}`;
}

describe('GymSoinsHealthy — validation E2E', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let accessToken: string;

  // Identifiants créés au fil du scénario.
  let productId: string;
  let ingredientId: string;
  let dishId: string;
  let orderId: string;

  beforeAll(async () => {
    const database = getTestDatabaseSettings();

    process.env.NODE_ENV = 'test';
    process.env.POSTGRES_HOST = database.host;
    process.env.POSTGRES_PORT = String(database.port);
    process.env.POSTGRES_USERNAME = database.user;
    process.env.POSTGRES_PASSWORD = database.password;
    process.env.POSTGRES_DATABASE = database.database;
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    process.env.JWT_EXPIRES_IN = '1h';
    process.env.LICENSE_SECRET = TEST_LICENSE_SECRET;
    process.env.OUTBOX_WORKER_ENABLED = 'false';
    process.env.OUTBOX_MAX_ATTEMPTS = '2';
    process.env.OUTBOX_BASE_BACKOFF_MS = '1';
    process.env.TRUST_PROXY = 'true';
    process.env.OBSERVABILITY_LOG_ENABLED = 'false';
    process.env.RETENTION_PURGE_ENABLED = 'false';
    delete process.env.LICENSE_KEY;
    delete process.env.LICENSE_HARDWARE_ID;

    await waitForDatabase(database);
    await resetTestDatabase(database);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    // Même configuration HTTP/sécurité que `src/main.ts`.
    configureApp(app);
    // Les tests de rate limiting utilisent X-Forwarded-For pour isoler les IP.
    app.getHttpAdapter().getInstance().set('trust proxy', true);
    await app.init();

    http = request(app.getHttpServer());
  }, 180_000);

  const signMembershipToken = async (
    email: string,
    role: string,
  ): Promise<string> => {
    const dataSource = app.get(DataSource);
    const rows = await dataSource.query(
      `SELECT u.id, tm.id AS "membershipId", tm."tenantId"
       FROM users u
       JOIN tenant_memberships tm ON tm."userId" = u.id
       WHERE u.email = $1 AND tm.status = 'ACTIVE'
       LIMIT 1`,
      [email],
    );

    if (rows.length === 0) {
      throw new Error(`Membreship introuvable pour ${email}`);
    }

    const jwtService = app.get(JwtService, { strict: false });
    return jwtService.sign({
      sub: rows[0].id,
      email,
      role,
      tenantId: rows[0].tenantId,
      membershipId: rows[0].membershipId,
    });
  };

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  // -------------------------------------------------------------------------
  // 1. Authentification & sécurité
  // -------------------------------------------------------------------------
  describe('1. Authentification & sécurité', () => {
    it('refuse des identifiants invalides (401)', async () => {
      await http
        .post('/api/v1/auth/login')
        .send({ email: TEST_ADMIN_EMAIL, password: 'mot-de-passe-invalide' })
        .expect(401);
    });

    it('connecte le SUPER_ADMIN et délivre un JWT valide', async () => {
      const response = await http
        .post('/api/v1/auth/login')
        .send({ email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD })
        .expect(200);

      expect(response.body.role).toBe('SUPER_ADMIN');
      expect(typeof response.body.access_token).toBe('string');
      expect(response.body.access_token.split('.')).toHaveLength(3);

      const jwtService = app.get(JwtService, { strict: false });
      const payload = jwtService.verify<{
        sub: string;
        email: string;
        role: string;
        tenantId: string;
      }>(response.body.access_token);

      expect(payload.sub).toBe(response.body.user.id);
      expect(payload.email).toBe(TEST_ADMIN_EMAIL);
      expect(payload.role).toBe('SUPER_ADMIN');
      expect(payload.tenantId).toBe(TEST_TENANT_ID);

      expect(response.body.tenant.id).toBe(TEST_TENANT_ID);
      expect(response.body.tenants).toHaveLength(1);

      accessToken = response.body.access_token;
    });

    it('refuse les routes métier sans jeton (401)', async () => {
      await http.get('/api/v1/gym/subscriptions').expect(401);
      await http.get('/api/v1/maintenance/equipments').expect(401);
      await http.get('/api/v1/healthy-food/ingredients').expect(401);
      await http
        .get('/api/v1/gym/access-logs')
        .set('Authorization', 'Bearer jeton.invalide.signature')
        .expect(401);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Licence Plug-and-Play (feature flags)
  // -------------------------------------------------------------------------
  describe('2. Licence Plug-and-Play', () => {
    it('renvoie les 7 modules activés par une licence « all »', async () => {
      const response = await http
        .get('/api/v1/license/features')
        .set('x-license-key', buildLicenseKey())
        .set('x-hardware-id', TEST_HARDWARE_ID)
        .expect(200);

      expect(response.body.modules).toHaveLength(ALL_MODULES.length);
      expect([...response.body.modules].sort()).toEqual([...ALL_MODULES].sort());
    });

    it('refuse une licence liée à une autre empreinte matérielle', async () => {
      await http
        .get('/api/v1/license/features')
        .set('x-license-key', buildLicenseKey(['all'], 'AUTRE-MATERIEL'))
        .set('x-hardware-id', TEST_HARDWARE_ID)
        .expect(401);
    });

    it('refuse une licence dont la signature est falsifiée', async () => {
      const forgedKey = `${buildLicenseKey().split('.')[0]}.${'0'.repeat(64)}`;

      await http
        .get('/api/v1/license/features')
        .set('x-license-key', forgedKey)
        .set('x-hardware-id', TEST_HARDWARE_ID)
        .expect(401);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Flux métier croisé
  // -------------------------------------------------------------------------
  describe('3. Flux métier croisé', () => {
    it('Gym — crée un abonnement actif et autorise le check-in', async () => {
      const subscription = await http
        .post('/api/v1/gym/subscriptions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          clientId: TEST_CLIENT_ID,
          type: 'MENSUEL',
          startDate: new Date(Date.now() - 60_000).toISOString(),
          endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        })
        .expect(201);

      expect(subscription.body.status).toBe('ACTIF');
      expect(subscription.body.clientId).toBe(TEST_CLIENT_ID);

      const checkIn = await http
        .post('/api/v1/gym/check-in')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ clientId: TEST_CLIENT_ID, method: 'QR_CODE' })
        .expect(201);

      expect(checkIn.body.granted).toBe(true);
      expect(checkIn.body.accessLog.direction).toBe('ENTREE');
      expect(checkIn.body.accessLog.method).toBe('QR_CODE');
    });

    it('Shop — valide une vente POS et décrémente le stock physique', async () => {
      const product = await http
        .post('/api/v1/shop')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Whey Protein E2E',
          sku: 'E2E-WHEY-0001',
          description: 'Produit créé par le test d’intégration',
          price: 12.5,
          stockQuantity: 10,
          category: 'COMPLEMENT',
          isService: false,
        })
        .expect(201);

      productId = product.body.id;
      expect(product.body.stockQuantity).toBe(10);

      const sale = await http
        .post('/api/v1/shop/sales')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          clientId: TEST_CLIENT_ID,
          paymentMethod: 'CARTE',
          items: [{ productId, quantity: 2 }],
        })
        .expect(201);

      expect(Number(sale.body.totalAmount)).toBeCloseTo(25, 2);
      expect(sale.body.items).toHaveLength(1);
      expect(Number(sale.body.items[0].unitPrice)).toBeCloseTo(12.5, 2);
      expect(sale.body.items[0].quantity).toBe(2);

      const updatedProduct = await http
        .get(`/api/v1/shop/${productId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(updatedProduct.body.stockQuantity).toBe(8);
    });

    it('Loyalty — crédite automatiquement les points de la vente', async () => {
      const balance = await http
        .get(`/api/v1/loyalty/balance/${TEST_CLIENT_ID}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      // 25 € dépensés × 1 point / € = 25 points.
      expect(balance.body.pointsBalance).toBe(25);
      expect(balance.body.totalEarned).toBe(25);
      expect(balance.body.totalSpent).toBe(0);

      const transactions = await http
        .get(`/api/v1/loyalty/transactions/${TEST_CLIENT_ID}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const saleTransaction = transactions.body.find(
        (transaction: { type: string }) => transaction.type === 'GAIN_ACHAT',
      );

      expect(saleTransaction).toBeDefined();
      expect(saleTransaction.points).toBe(25);
      expect(saleTransaction.description).toMatch(/Achat boutique/);
    });

    it('Healthy Food — crée un plat, sa recette et vérifie les stocks à la commande', async () => {
      const ingredient = await http
        .post('/api/v1/healthy-food/ingredients')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Poulet E2E',
          unit: 'GRAMMES',
          stockQuantity: 1000,
          alertThreshold: 100,
        })
        .expect(201);

      ingredientId = ingredient.body.id;
      expect(ingredient.body.isLowStock).toBeUndefined();
      expect(Number(ingredient.body.stockQuantity)).toBeCloseTo(1000, 3);

      const dish = await http
        .post('/api/v1/healthy-food/dishes')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Poulet grillé E2E',
          description: 'Plat du test d’intégration',
          price: 15.5,
          isCustomizable: false,
          type: 'SUR_COMMANDE',
        })
        .expect(201);

      dishId = dish.body.id;

      await http
        .post(`/api/v1/healthy-food/dishes/${dishId}/ingredients`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ ingredientId, quantityNeeded: 150 })
        .expect(201);

      const order = await http
        .post('/api/v1/healthy-food/orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          clientId: TEST_CLIENT_ID,
          type: 'SUR_PLACE',
          items: [{ dishId, quantity: 2 }],
        })
        .expect(201);

      orderId = order.body.id;
      expect(order.body.status).toBe('EN_ATTENTE');
      expect(order.body.items[0]).toMatchObject({ dishId, quantity: 2 });

      // 2 × 150 g = 300 g consommés → 700 g restants.
      const ingredientAfterOrder = await http
        .get(`/api/v1/healthy-food/ingredients/${ingredientId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(Number(ingredientAfterOrder.body.stockQuantity)).toBeCloseTo(700, 3);
    });

    it('Healthy Food — rejette une commande en rupture d’ingrédient sans toucher au stock', async () => {
      // 10 × 150 g = 1500 g, stock insuffisant (700 g).
      const shortage = await http
        .post('/api/v1/healthy-food/orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          clientId: TEST_CLIENT_ID,
          type: 'A_EMPORTER',
          items: [{ dishId, quantity: 10 }],
        })
        .expect(400);

      expect(shortage.body.message).toMatch(/Rupture d'ingrédient/);

      const ingredientAfterShortage = await http
        .get(`/api/v1/healthy-food/ingredients/${ingredientId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(Number(ingredientAfterShortage.body.stockQuantity)).toBeCloseTo(700, 3);
    });

    it('Healthy Food — applique les transitions KDS valides et refuse les autres', async () => {
      const preparing = await http
        .put(`/api/v1/healthy-food/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ status: 'EN_PREPARATION' })
        .expect(200);

      expect(preparing.body.status).toBe('EN_PREPARATION');

      const ready = await http
        .put(`/api/v1/healthy-food/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ status: 'PRET' })
        .expect(200);

      expect(ready.body.status).toBe('PRET');

      // Retour arrière interdit : PRET → EN_ATTENTE.
      await http
        .put(`/api/v1/healthy-food/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ status: 'EN_ATTENTE' })
        .expect(400);

      const clientOrders = await http
        .get(`/api/v1/healthy-food/orders/client/${TEST_CLIENT_ID}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(clientOrders.body).toHaveLength(1);
      expect(clientOrders.body[0].id).toBe(orderId);
      expect(clientOrders.body[0].status).toBe('PRET');

      const dataSource = app.get(DataSource);
      const statusEvents = await dataSource.query(
        `SELECT COUNT(*)::int AS count FROM outbox_events
         WHERE "eventType" = 'kitchen.order.status_changed'
           AND "aggregateId" = $1`,
        [orderId],
      );

      expect(statusEvents[0].count).toBeGreaterThanOrEqual(2);
    });

    it('Healthy Food — restaure les stocks à l’annulation d’une commande', async () => {
      const cancelled = await http
        .put(`/api/v1/healthy-food/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ status: 'ANNULE' })
        .expect(200);

      expect(cancelled.body.status).toBe('ANNULE');

      // Les 300 g consommés (2 × 150 g) sont rendus au stock.
      const ingredientAfterCancel = await http
        .get(`/api/v1/healthy-food/ingredients/${ingredientId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(Number(ingredientAfterCancel.body.stockQuantity)).toBeCloseTo(
        1000,
        3,
      );

      // Une commande annulée est terminale : aucun retour en arrière possible.
      await http
        .put(`/api/v1/healthy-food/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ status: 'EN_ATTENTE' })
        .expect(400);
    });
  });

  // -------------------------------------------------------------------------
  // 3bis. Idempotence transactionnelle
  // -------------------------------------------------------------------------
  describe('3bis. Idempotence transactionnelle', () => {
    const suffix = Date.now();

    const createProduct = async (label: string, stockQuantity: number) => {
      const response = await http
        .post('/api/v1/shop')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: `Produit idempotence ${label}`,
          sku: `E2E-IDEM-${label}-${suffix}`,
          price: 10,
          stockQuantity,
          category: 'BOISSON',
          isActive: true,
        })
        .expect(201);

      return response.body;
    };

    it('Shop — même clé, même payload : même vente et stock décrémenté une fois', async () => {
      const product = await createProduct('SHOP', 3);
      const key = `e2e-idem-shop-${suffix}`;
      const payload = {
        items: [{ productId: product.id, quantity: 1 }],
        paymentMethod: 'ESPECES',
      };

      const first = await http
        .post('/api/v1/shop/sales/process')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Idempotency-Key', key)
        .send(payload)
        .expect(201);

      const replay = await http
        .post('/api/v1/shop/sales/process')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Idempotency-Key', key)
        .send(payload)
        .expect(201);

      expect(replay.body.saleId).toBe(first.body.saleId);
      expect(replay.body.totalAmount).toBe(first.body.totalAmount);

      const productAfter = await http
        .get(`/api/v1/shop/${product.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(productAfter.body.stockQuantity).toBe(2);

      await http
        .post('/api/v1/shop/sales/process')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Idempotency-Key', key)
        .send({
          items: [{ productId: product.id, quantity: 2 }],
          paymentMethod: 'ESPECES',
        })
        .expect(409);
    });

    it('Shop — deux requêtes simultanées avec la même clé ne créent qu’une vente', async () => {
      const product = await createProduct('CONCURRENT', 2);
      const key = `e2e-idem-concurrent-${suffix}`;
      const payload = {
        items: [{ productId: product.id, quantity: 1 }],
        paymentMethod: 'ESPECES',
      };

      const [first, second] = await Promise.all([
        http
          .post('/api/v1/shop/sales/process')
          .set('Authorization', `Bearer ${accessToken}`)
          .set('Idempotency-Key', key)
          .send(payload),
        http
          .post('/api/v1/shop/sales/process')
          .set('Authorization', `Bearer ${accessToken}`)
          .set('Idempotency-Key', key)
          .send(payload),
      ]);

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(first.body.saleId).toBe(second.body.saleId);

      const productAfter = await http
        .get(`/api/v1/shop/${product.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(productAfter.body.stockQuantity).toBe(1);
    });

    it('Shop — une transaction en échec ne persiste pas la clé et autorise le retry', async () => {
      const dataSource = app.get(DataSource);
      const product = await createProduct('ROLLBACK', 1);
      const key = `e2e-idem-rollback-${suffix}`;

      const outboxBefore = await dataSource.query(
        'SELECT COUNT(*)::int AS count FROM outbox_events',
      );

      await http
        .post('/api/v1/shop/sales/process')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Idempotency-Key', key)
        .send({
          items: [{ productId: product.id, quantity: 2 }],
          paymentMethod: 'ESPECES',
        })
        .expect(400);

      const outboxAfterFailure = await dataSource.query(
        'SELECT COUNT(*)::int AS count FROM outbox_events',
      );
      expect(outboxAfterFailure[0].count).toBe(outboxBefore[0].count);

      const retry = await http
        .post('/api/v1/shop/sales/process')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Idempotency-Key', key)
        .send({
          items: [{ productId: product.id, quantity: 1 }],
          paymentMethod: 'ESPECES',
        })
        .expect(201);

      expect(retry.body.saleId).toBeTruthy();

      const outboxAfterSuccess = await dataSource.query(
        'SELECT COUNT(*)::int AS count FROM outbox_events',
      );
      expect(outboxAfterSuccess[0].count).toBe(outboxBefore[0].count + 1);
    });

    it('Care — même clé, même consommation : une seule séance décrémentée', async () => {
      const clientId = `e2e-idem-care-${suffix}`;
      const careService = await http
        .post('/api/v1/care/services')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          title: `Pack idempotence ${suffix}`,
          durationMinutes: 60,
          price: 50,
          type: 'PACK',
        })
        .expect(201);

      await http
        .post('/api/v1/care/packages/assign')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          clientId,
          careServiceId: careService.body.id,
          totalSessions: 2,
        })
        .expect(201);

      const key = `e2e-idem-care-${suffix}`;
      const payload = {
        clientId,
        careServiceId: careService.body.id,
        therapistId: `therapist-${suffix}`,
      };

      const first = await http
        .post('/api/v1/care/sessions/consume')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Idempotency-Key', key)
        .send(payload)
        .expect(201);

      const replay = await http
        .post('/api/v1/care/sessions/consume')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Idempotency-Key', key)
        .send(payload)
        .expect(201);

      expect(replay.body.session.id).toBe(first.body.session.id);

      const packages = await http
        .get(`/api/v1/care/packages/client/${clientId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(packages.body[0].remainingSessions).toBe(1);
    });

    it('Healthy Food — même clé, même commande : un seul décrément de stock', async () => {
      const ingredient = await http
        .post('/api/v1/healthy-food/ingredients')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: `Ingrédient idempotence ${suffix}`,
          unit: 'UNITE',
          stockQuantity: 10,
          alertThreshold: 1,
        })
        .expect(201);

      const dish = await http
        .post('/api/v1/healthy-food/dishes')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: `Plat idempotence ${suffix}`,
          price: 12,
          category: 'PLAT',
          isAvailable: true,
          type: 'SUR_COMMANDE',
        })
        .expect(201);

      await http
        .post(`/api/v1/healthy-food/dishes/${dish.body.id}/ingredients`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          ingredientId: ingredient.body.id,
          quantityNeeded: 1,
        })
        .expect(201);

      const key = `e2e-idem-food-${suffix}`;
      const payload = {
        clientId: `e2e-idem-food-${suffix}`,
        type: 'SUR_PLACE',
        items: [{ dishId: dish.body.id, quantity: 1 }],
      };

      const first = await http
        .post('/api/v1/healthy-food/orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Idempotency-Key', key)
        .send(payload)
        .expect(201);

      const replay = await http
        .post('/api/v1/healthy-food/orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Idempotency-Key', key)
        .send(payload)
        .expect(201);

      expect(replay.body.id).toBe(first.body.id);

      const ingredientAfter = await http
        .get(`/api/v1/healthy-food/ingredients/${ingredient.body.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(Number(ingredientAfter.body.stockQuantity)).toBe(9);
    });
  });

  // -------------------------------------------------------------------------
  // 3ter. Outbox transactionnelle et worker
  // -------------------------------------------------------------------------
  describe('3ter. Outbox transactionnelle et worker', () => {
    const suffix = Date.now();

    it('Shop — la vente et sale.completed sont persistés ensemble puis traités', async () => {
      const dataSource = app.get(DataSource);
      const outbox = app.get(OutboxService);
      const clientId = `e2e-outbox-client-${suffix}`;

      const product = await http
        .post('/api/v1/shop')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: `Produit outbox ${suffix}`,
          sku: `E2E-OUTBOX-${suffix}`,
          price: 12.5,
          stockQuantity: 2,
          category: 'BOISSON',
          isActive: true,
        })
        .expect(201);

      const key = `e2e-outbox-sale-${suffix}`;
      const traceId = 'a'.repeat(32);
      const payload = {
        clientId,
        items: [{ productId: product.body.id, quantity: 1 }],
        paymentMethod: 'CARTE',
      };

      const sale = await http
        .post('/api/v1/shop/sales/process')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Idempotency-Key', key)
        .set('traceparent', `00-${traceId}-${'b'.repeat(16)}-01`)
        .send(payload)
        .expect(201);

      expect(sale.headers['x-trace-id']).toBe(traceId);

      // Le dispatch immédiat attend le listener : la fidélité est disponible.
      const balance = await http
        .get(`/api/v1/loyalty/balance/${clientId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(balance.body.pointsBalance).toBe(12);

      const events = await dataSource.query(
        `SELECT id, "eventType", "aggregateType", "aggregateId", status, attempts, "traceId", "spanId"
         FROM outbox_events WHERE "aggregateId" = $1`,
        [sale.body.saleId],
      );

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        eventType: 'sale.completed',
        aggregateType: 'sale',
        aggregateId: sale.body.saleId,
        status: 'PROCESSED',
        attempts: 1,
        traceId,
      });
      expect(events[0].spanId).toBeTruthy();

      // Replay idempotent : aucun second événement outbox.
      await http
        .post('/api/v1/shop/sales/process')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Idempotency-Key', key)
        .send(payload)
        .expect(201);

      const eventsAfterReplay = await dataSource.query(
        'SELECT COUNT(*)::int AS count FROM outbox_events WHERE "aggregateId" = $1',
        [sale.body.saleId],
      );

      expect(eventsAfterReplay[0].count).toBe(1);

      // Redelivery volontaire : l'idempotence du listener Loyalty évite
      // un second crédit de points.
      await dataSource.query(
        `UPDATE outbox_events
         SET status = 'PENDING', "processedAt" = NULL, attempts = 0, "availableAt" = NOW()
         WHERE id = $1`,
        [events[0].id],
      );

      await outbox.processBatch();

      const balanceAfterRedelivery = await http
        .get(`/api/v1/loyalty/balance/${clientId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(balanceAfterRedelivery.body.pointsBalance).toBe(12);

      const eventAfterRedelivery = await outbox.findById(events[0].id);
      expect(eventAfterRedelivery?.status).toBe('PROCESSED');
    });

    it('Worker — retry, FAILED, reprise et succès sans listener', async () => {
      const dataSource = app.get(DataSource);
      const outbox = app.get(OutboxService);
      const emitter = app.get(EventEmitter2);

      const failingListener = () => {
        throw new Error('listener failure simulated');
      };
      emitter.on('test.outbox.retry', failingListener);

      let eventId: string;

      await runWithTenantContext(
        {
          tenantId: TEST_TENANT_ID,
          userId: 'e2e-outbox',
          role: 'SUPER_ADMIN',
          membershipId: 'e2e-outbox',
        },
        () =>
          dataSource.transaction(async (manager) => {
            eventId = await outbox.append(manager, {
              eventType: 'test.outbox.retry',
              aggregateType: 'test',
              aggregateId: `test-outbox-${suffix}`,
              payload: { hello: 'world' },
            });
          }),
      );

      await outbox.processBatch();

      let event = await outbox.findById(eventId);
      expect(event?.status).toBe('PENDING');
      expect(event?.attempts).toBe(1);
      expect(event?.lastError).toContain('listener failure simulated');

      await dataSource.query(
        'UPDATE outbox_events SET "availableAt" = NOW() WHERE id = $1',
        [eventId],
      );
      await outbox.processBatch();

      event = await outbox.findById(eventId);
      expect(event?.status).toBe('FAILED');
      expect(event?.attempts).toBe(2);

      const stats = await http
        .get('/api/v1/outbox/stats')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(stats.body.FAILED).toBeGreaterThanOrEqual(1);

      const retried = await http
        .post(`/api/v1/outbox/${eventId}/retry`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(201);

      expect(retried.body.status).toBe('PENDING');
      expect(retried.body.attempts).toBe(0);

      emitter.off('test.outbox.retry', failingListener);

      await dataSource.query(
        'UPDATE outbox_events SET "availableAt" = NOW() WHERE id = $1',
        [eventId],
      );
      await outbox.processBatch();

      event = await outbox.findById(eventId);
      expect(event?.status).toBe('PROCESSED');
      expect(event?.processedAt).toBeTruthy();
      expect(event?.lastError).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 3quater. Booking — contraintes PostgreSQL
  // -------------------------------------------------------------------------
  describe('3quater. Booking — contraintes PostgreSQL', () => {
    const suffix = Date.now();

    it('deux réservations concurrentes sur le même créneau → 1 succès / 1 conflit', async () => {
      const resourceId = randomUUID();
      const practitioner = `e2e-booking-pract-${suffix}`;
      const start = new Date(Date.now() + 60 * 60 * 1000);
      const end = new Date(start.getTime() + 60 * 60 * 1000);

      const create = (clientId: string) =>
        http
          .post('/api/v1/bookings')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            clientId,
            resourceType: 'EQUIPMENT',
            resourceId,
            practitionerOrCoachId: practitioner,
            startTime: start.toISOString(),
            endTime: end.toISOString(),
          });

      const [first, second] = await Promise.all([
        create(`e2e-booking-a-${suffix}`),
        create(`e2e-booking-b-${suffix}`),
      ]);

      expect([first.status, second.status].sort()).toEqual([201, 409]);
    });

    it('la contrainte d’exclusion PostgreSQL refuse un chevauchement direct', async () => {
      const dataSource = app.get(DataSource);
      const resourceId = randomUUID();
      const practitioner = `e2e-booking-db-pract-${suffix}`;
      const start = new Date(Date.now() + 2 * 60 * 60 * 1000);
      const end = new Date(start.getTime() + 60 * 60 * 1000);

      await dataSource.query(
        `INSERT INTO bookings
          ("tenantId", "clientId", "resourceType", "resourceId", "practitionerOrCoachId", "startTime", "endTime")
         VALUES ($1, $2, 'EQUIPMENT', $3, $4, $5, $6)`,
        [
          TEST_TENANT_ID,
          `e2e-booking-db-a-${suffix}`,
          resourceId,
          practitioner,
          start,
          end,
        ],
      );

      await expect(
        dataSource.query(
          `INSERT INTO bookings
            ("tenantId", "clientId", "resourceType", "resourceId", "practitionerOrCoachId", "startTime", "endTime")
           VALUES ($1, $2, 'EQUIPMENT', $3, $4, $5, $6)`,
          [
            TEST_TENANT_ID,
            `e2e-booking-db-b-${suffix}`,
            resourceId,
            practitioner,
            start,
            end,
          ],
        ),
      ).rejects.toMatchObject({
        driverError: { code: '23P01' },
      });
    });
  });

  // -------------------------------------------------------------------------
  // 3quinquies. KDS SSE
  // -------------------------------------------------------------------------
  describe('3quinquies. KDS SSE', () => {
    it('crée un ticket court et le consomme une seule fois', async () => {
      const ticketService = app.get(KdsStreamTicketService);
      const created = await ticketService.create('e2e-kds-user', 'CHEF', TEST_TENANT_ID);

      const firstUse = await ticketService.consume(created.ticket);
      expect(firstUse).toMatchObject({
        userId: 'e2e-kds-user',
        role: 'CHEF',
        tenantId: TEST_TENANT_ID,
      });

      const replay = await ticketService.consume(created.ticket);
      expect(replay).toBeNull();
    });

    it('protège la création de ticket par authentification et rôle KDS', async () => {
      await http
        .post('/api/v1/healthy-food/kds/stream-ticket')
        .expect(401);

      const receptionistToken = await signMembershipToken(
        TEST_RECEPTIONIST_EMAIL,
        'RECEPTIONIST',
      );

      await http
        .post('/api/v1/healthy-food/kds/stream-ticket')
        .set('Authorization', `Bearer ${receptionistToken}`)
        .expect(403);

      const ticket = await http
        .post('/api/v1/healthy-food/kds/stream-ticket')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(typeof ticket.body.ticket).toBe('string');
      expect(ticket.body.ticket.length).toBeGreaterThan(20);
      expect(ticket.body.expiresAt).toBeTruthy();
    });

    it('rejette les tickets expirés et invalides', async () => {
      const ticketService = app.get(KdsStreamTicketService);
      const dataSource = app.get(DataSource);
      const created = await ticketService.create('e2e-expired', 'CHEF', TEST_TENANT_ID);
      const tokenHash = createHash('sha256')
        .update(created.ticket)
        .digest('hex');

      await dataSource.query(
        `UPDATE kds_stream_tickets
         SET "expiresAt" = NOW() - INTERVAL '1 second'
         WHERE "tokenHash" = $1`,
        [tokenHash],
      );

      await expect(ticketService.consume(created.ticket)).resolves.toBeNull();
      await expect(ticketService.consume('not-a-valid-ticket')).resolves.toBeNull();
    });

    it('ne permet pas au client de choisir un tenant dans la requête', async () => {
      const ticketService = app.get(KdsStreamTicketService);
      const response = await http
        .post(
          '/api/v1/healthy-food/kds/stream-ticket?tenantId=tenant-b&tenant=tenant-b',
        )
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ tenantId: 'tenant-b', tenant: 'tenant-b' })
        .expect(200);

      const session = await ticketService.consume(response.body.ticket);

      // Le tenant du ticket est dérivé du contexte serveur, jamais du body/query.
      expect(session).toMatchObject({ tenantId: TEST_TENANT_ID });
    });
  });


  // -------------------------------------------------------------------------
  // 3sexies. Isolation multi-tenant A/B
  // -------------------------------------------------------------------------
  describe('3sexies. Isolation multi-tenant A/B', () => {
    let tokenA: string;
    let tokenB: string;
    let tenantA: string;
    let tenantB: string;
    let userA: string;
    let productA: string;
    let productB: string;
    let bookingA: string;
    let careServiceA: string;
    let ingredientA: string;
    let dishA: string;
    let orderA: string;
    let equipmentA: string;
    let subscriptionA: string;

    const suffix = Date.now();
    const registerTenant = (name: string, email: string, ip: string) =>
      http
        .post('/api/v1/auth/register')
        .set('X-Forwarded-For', ip)
        .send({
          email,
          password: 'TenantE2E123!',
          username: name,
          tenantName: `E2E ${name}`,
        })
        .expect(201);

    it('crée deux tenants indépendants avec leur premier administrateur', async () => {
      const [a, b] = await Promise.all([
        registerTenant(`tenant-a-${suffix}`, `owner-a-${suffix}@gymsoins.local`, '10.10.10.11'),
        registerTenant(`tenant-b-${suffix}`, `owner-b-${suffix}@gymsoins.local`, '10.10.10.12'),
      ]);

      tokenA = a.body.access_token;
      tokenB = b.body.access_token;
      tenantA = a.body.tenant.id;
      tenantB = b.body.tenant.id;
      userA = a.body.user.id;

      expect(a.body.role).toBe('SUPER_ADMIN');
      expect(b.body.role).toBe('SUPER_ADMIN');
      expect(tenantA).not.toBe(tenantB);

      const current = await http
        .get('/api/v1/tenant/current')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(current.body.id).toBe(tenantA);
    });

    it('isole le catalogue Shop, les ventes et l’idempotence', async () => {
      const sku = `MT-SHOP-${suffix}`;
      const [a, b] = await Promise.all([
        http
          .post('/api/v1/shop')
          .set('Authorization', `Bearer ${tokenA}`)
          .send({
            name: `Produit A ${suffix}`,
            sku,
            price: 10,
            stockQuantity: 1,
            category: 'BOISSON',
            isActive: true,
          })
          .expect(201),
        http
          .post('/api/v1/shop')
          .set('Authorization', `Bearer ${tokenB}`)
          .send({
            name: `Produit B ${suffix}`,
            sku,
            price: 20,
            stockQuantity: 1,
            category: 'BOISSON',
            isActive: true,
          })
          .expect(201),
      ]);

      productA = a.body.id;
      productB = b.body.id;

      const listA = await http
        .get('/api/v1/shop')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(listA.body.map((p: { id: string }) => p.id)).toContain(productA);
      expect(listA.body.map((p: { id: string }) => p.id)).not.toContain(productB);

      await http
        .get(`/api/v1/shop/${productA}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);

      await http
        .patch(`/api/v1/shop/${productA}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ name: 'tentative-croisee' })
        .expect(404);

      await http
        .delete(`/api/v1/shop/${productA}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);

      await http
        .post('/api/v1/shop/sales/process')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          items: [{ productId: productA, quantity: 1 }],
          paymentMethod: 'ESPECES',
        })
        .expect(404);

      const key = `mt-same-key-${suffix}`;
      const saleA = await http
        .post('/api/v1/shop/sales/process')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('Idempotency-Key', key)
        .send({
          items: [{ productId: productA, quantity: 1 }],
          paymentMethod: 'ESPECES',
        })
        .expect(201);

      const saleB = await http
        .post('/api/v1/shop/sales/process')
        .set('Authorization', `Bearer ${tokenB}`)
        .set('Idempotency-Key', key)
        .send({
          items: [{ productId: productB, quantity: 1 }],
          paymentMethod: 'ESPECES',
        })
        .expect(201);

      expect(saleA.body.saleId).not.toBe(saleB.body.saleId);
    });

    it('isole Booking, y compris les contraintes d’exclusion', async () => {
      const resourceId = randomUUID();
      const practitioner = `mt-booking-${suffix}`;
      const start = new Date(Date.now() + 3 * 60 * 60 * 1000);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      const payload = (clientId: string) => ({
        clientId,
        resourceType: 'EQUIPMENT',
        resourceId,
        practitionerOrCoachId: practitioner,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
      });

      const a = await http
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(payload(`mt-booking-a-${suffix}`))
        .expect(201);
      bookingA = a.body.id;

      // Même ressource, même créneau, autre tenant : autorisé.
      await http
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${tokenB}`)
        .send(payload(`mt-booking-b-${suffix}`))
        .expect(201);

      const listB = await http
        .get('/api/v1/bookings')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      expect(
        listB.body.map((b: { clientId: string }) => b.clientId),
      ).not.toContain(`mt-booking-a-${suffix}`);

      await http
        .delete(`/api/v1/bookings/${bookingA}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
    });

    it('isole Care, Healthy Food, Maintenance et Gym par ID', async () => {
      const care = await http
        .post('/api/v1/care/services')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          title: `Pack MT ${suffix}`,
          durationMinutes: 45,
          price: 50,
          type: 'PACK',
        })
        .expect(201);
      careServiceA = care.body.id;

      await http
        .get(`/api/v1/care/services/${careServiceA}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);

      await http
        .post('/api/v1/care/packages/assign')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ clientId: `mt-care-client-${suffix}`, careServiceId: careServiceA, totalSessions: 2 })
        .expect(404);

      const ingredient = await http
        .post('/api/v1/healthy-food/ingredients')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: `MT ingredient ${suffix}`,
          unit: 'UNITE',
          stockQuantity: 3,
          alertThreshold: 0,
        })
        .expect(201);
      ingredientA = ingredient.body.id;

      const dish = await http
        .post('/api/v1/healthy-food/dishes')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: `MT dish ${suffix}`,
          price: 9,
          category: 'PLAT',
          isAvailable: true,
          type: 'SUR_COMMANDE',
        })
        .expect(201);
      dishA = dish.body.id;

      await http
        .post(`/api/v1/healthy-food/dishes/${dishA}/ingredients`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ ingredientId: ingredientA, quantityNeeded: 1 })
        .expect(201);

      await http
        .get(`/api/v1/healthy-food/ingredients/${ingredientA}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
      await http
        .get(`/api/v1/healthy-food/dishes/${dishA}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);

      await http
        .post('/api/v1/healthy-food/orders')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          clientId: `mt-kds-b-${suffix}`,
          type: 'SUR_PLACE',
          items: [{ dishId: dishA, quantity: 1 }],
        })
        .expect(404);

      const order = await http
        .post('/api/v1/healthy-food/orders')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          clientId: `mt-kds-a-${suffix}`,
          type: 'SUR_PLACE',
          items: [{ dishId: dishA, quantity: 1 }],
        })
        .expect(201);
      orderA = order.body.id;

      await http
        .put(`/api/v1/healthy-food/orders/${orderA}/status`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ status: 'EN_PREPARATION' })
        .expect(404);

      const equipment = await http
        .post('/api/v1/maintenance/equipments')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: `MT equipment ${suffix}`,
          serialNumber: `MT-SERIAL-${suffix}`,
          category: 'CARDIO',
          location: 'Salle A',
        })
        .expect(201);
      equipmentA = equipment.body.id;

      // Le même numéro de série est autorisé dans un autre tenant.
      await http
        .post('/api/v1/maintenance/equipments')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          name: `MT equipment B ${suffix}`,
          serialNumber: `MT-SERIAL-${suffix}`,
          category: 'CARDIO',
          location: 'Salle B',
        })
        .expect(201);

      await http
        .get(`/api/v1/maintenance/equipments/${equipmentA}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
      await http
        .post('/api/v1/maintenance/tickets')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          equipmentId: equipmentA,
          reportedByUserId: 'mt-b-user',
          description: 'tentative croisée',
        })
        .expect(404);

      const subscription = await http
        .post('/api/v1/gym/subscriptions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          clientId: `mt-gym-client-${suffix}`,
          type: 'MENSUEL',
          startDate: new Date(Date.now() - 3600_000).toISOString(),
          endDate: new Date(Date.now() + 86_400_000).toISOString(),
        })
        .expect(201);
      subscriptionA = subscription.body.id;

      await http
        .get(`/api/v1/gym/subscriptions/${subscriptionA}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
    });

    it('isole Loyalty et les statistiques Outbox', async () => {
      const clientId = `mt-loyalty-${suffix}`;

      await http
        .post('/api/v1/loyalty/credit')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ clientId, points: 7 })
        .expect(201);

      await http
        .get(`/api/v1/loyalty/balance/${clientId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);

      // Le même clientId crée un compte distinct dans le tenant B.
      await http
        .post('/api/v1/loyalty/credit')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ clientId, points: 3 })
        .expect(201);

      const balanceA = await http
        .get(`/api/v1/loyalty/balance/${clientId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const balanceB = await http
        .get(`/api/v1/loyalty/balance/${clientId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);
      expect(balanceA.body.pointsBalance).toBe(7);
      expect(balanceB.body.pointsBalance).toBe(3);

      const dataSource = app.get(DataSource);
      await dataSource.query(
        `INSERT INTO outbox_events
          ("tenantId", "eventType", "aggregateType", "aggregateId", payload, status, attempts, "availableAt", "lastError", "createdAt", "updatedAt")
         VALUES ($1, 'test.mt.failed', 'test', $2, '{}'::jsonb, 'FAILED', 1, NOW(), 'mt failure', NOW(), NOW()),
                ($3, 'test.mt.failed', 'test', $4, '{}'::jsonb, 'FAILED', 1, NOW(), 'mt failure', NOW(), NOW())`,
        [tenantA, `mt-outbox-a-${suffix}`, tenantB, `mt-outbox-b-${suffix}`],
      );

      const statsA = await http
        .get('/api/v1/outbox/stats')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const statsB = await http
        .get('/api/v1/outbox/stats')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      expect(statsA.body.FAILED).toBe(1);
      expect(statsB.body.FAILED).toBe(1);
    });

    it('gère plusieurs adhésions et refuse un tenant non autorisé', async () => {
      const dataSource = app.get(DataSource);
      const role = await dataSource.query(
        `SELECT id FROM roles WHERE name = 'CHEF'`,
      );

      await dataSource.query(
        `INSERT INTO tenant_memberships ("tenantId", "userId", "roleId", status)
         VALUES ($1, $2, $3, 'ACTIVE')
         ON CONFLICT ("tenantId", "userId") DO NOTHING`,
        [tenantB, userA, role[0].id],
      );

      const noTenant = await http
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', '10.10.10.13')
        .send({ email: `owner-a-${suffix}@gymsoins.local`, password: 'TenantE2E123!' })
        .expect(409);

      expect(noTenant.body.code).toBe('TENANT_SELECTION_REQUIRED');
      expect(noTenant.body.tenants).toHaveLength(2);

      const selected = await http
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', '10.10.10.14')
        .send({
          email: `owner-a-${suffix}@gymsoins.local`,
          password: 'TenantE2E123!',
          tenantId: tenantB,
        })
        .expect(200);

      expect(selected.body.tenant.id).toBe(tenantB);
      expect(selected.body.role).toBe('CHEF');

      const switched = await http
        .post('/api/v1/auth/switch-tenant')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ tenantId: tenantB })
        .expect(200);

      expect(switched.body.tenant.id).toBe(tenantB);

      const tenants = await http
        .get('/api/v1/auth/tenants')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(tenants.body.map((t: { id: string }) => t.id).sort()).toEqual(
        [tenantA, tenantB].sort(),
      );

      const members = await http
        .get('/api/v1/tenant/members')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(JSON.stringify(members.body)).not.toContain('passwordHash');
      expect(members.body[0].user.email).toBe(`owner-a-${suffix}@gymsoins.local`);

      await http
        .post('/api/v1/auth/switch-tenant')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ tenantId: '11111111-1111-4111-8111-111111111111' })
        .expect(403);
    });

    it('isole les tickets SSE et le flux KDS par tenant', async () => {
      const ticketService = app.get(KdsStreamTicketService);
      const events = app.get(KdsEventsService);
      const dataSource = app.get(DataSource);

      const ticketA = await ticketService.create('mt-a', 'CHEF', tenantA);
      const ticketB = await ticketService.create('mt-b', 'CHEF', tenantB);
      await expect(ticketService.consume(ticketA.ticket)).resolves.toMatchObject({
        tenantId: tenantA,
      });
      await expect(ticketService.consume(ticketB.ticket)).resolves.toMatchObject({
        tenantId: tenantB,
      });

      const receivedA: Array<Record<string, any>> = [];
      const receivedB: Array<Record<string, any>> = [];

      const subA = events.stream(tenantA).subscribe((message) => {
        const data = message.data as Record<string, any>;
        if (data?.eventType === 'kitchen.order.status_changed') receivedA.push(data);
      });
      const subB = events.stream(tenantB).subscribe((message) => {
        const data = message.data as Record<string, any>;
        if (data?.eventType === 'kitchen.order.status_changed') receivedB.push(data);
      });

      const orderId = `mt-sse-order-${suffix}`;
      await dataSource.query(
        `INSERT INTO outbox_events
          ("tenantId", "eventType", "aggregateType", "aggregateId", payload, status, attempts, "availableAt", "processedAt", "createdAt", "updatedAt")
         VALUES ($1, 'kitchen.order.status_changed', 'kitchen_order', $2, $3::jsonb, 'PROCESSED', 1, NOW(), NOW(), NOW(), NOW())`,
        [tenantA, orderId, JSON.stringify({ orderId, status: 'EN_PREPARATION' })],
      );

      await new Promise((resolve) => setTimeout(resolve, 1800));
      subA.unsubscribe();
      subB.unsubscribe();

      expect(receivedA.some((event) => event.payload?.orderId === orderId)).toBe(true);
      expect(receivedB.some((event) => event.payload?.orderId === orderId)).toBe(false);
    });

    it('refuse tout accès service sans contexte tenant explicite', async () => {
      const bookingService = app.get(BookingService);
      await expect(bookingService.findAllBookings()).rejects.toThrow(
        'Contexte tenant absent',
      );
    });
  });

  // -------------------------------------------------------------------------
  // 4. Configuration & Whitelabel
  // -------------------------------------------------------------------------
  describe('4. Configuration & Whitelabel', () => {
    it('expose le branding publiquement sans données sensibles', async () => {
      const branding = await http
        .get('/api/v1/settings/branding')
        .expect(200);

      expect(branding.body).toMatchObject({
        gymName: 'GymSoinsHealthy',
        logoUrl: null,
        currency: 'EUR',
        locale: 'fr',
      });
      expect(branding.body.taxRates).toBeUndefined();
      expect(branding.body.cancellationPolicy).toBeUndefined();
    });

    it('protège la configuration complète (401 sans jeton, 403 hors admin)', async () => {
      await http.get('/api/v1/settings').expect(401);
      await http
        .put('/api/v1/settings')
        .send({ gymName: 'Test non autorisé' })
        .expect(401);

      const receptionistToken = await signMembershipToken(
        TEST_RECEPTIONIST_EMAIL,
        'RECEPTIONIST',
      );

      await http
        .get('/api/v1/settings')
        .set('Authorization', `Bearer ${receptionistToken}`)
        .expect(403);

      await http
        .put('/api/v1/settings')
        .set('Authorization', `Bearer ${receptionistToken}`)
        .send({ gymName: 'Interdit' })
        .expect(403);
    });

    it('met à jour la configuration en tant que SUPER_ADMIN et l’applique au branding', async () => {
      const update = await http
        .put('/api/v1/settings')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          gymName: 'Atlas Fitness Club',
          logoUrl: 'https://cdn.example.com/logo.png',
          primaryColor: '#F97316',
          secondaryColor: '#0EA5E9',
          currency: 'MAD',
          locale: 'fr-MA',
          taxRates: [
            { id: 'standard', label: 'TVA standard', rate: 20 },
            { label: 'TVA réduite', rate: 7 },
          ],
          cancellationPolicy: {
            freeCancellationHours: 48,
            lateCancellationFeePercent: 30,
            noShowFeePercent: 100,
            notes: 'Annulation gratuite jusqu’à 48 h avant le cours.',
          },
        })
        .expect(200);

      expect(update.body).toMatchObject({
        gymName: 'Atlas Fitness Club',
        logoUrl: 'https://cdn.example.com/logo.png',
        primaryColor: '#f97316',
        secondaryColor: '#0ea5e9',
        currency: 'MAD',
        locale: 'fr-MA',
      });
      expect(update.body.taxRates).toHaveLength(2);
      expect(update.body.taxRates[1].id).toBeTruthy();
      expect(update.body.cancellationPolicy.freeCancellationHours).toBe(48);

      const full = await http
        .get('/api/v1/settings')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(full.body.gymName).toBe('Atlas Fitness Club');

      const branding = await http
        .get('/api/v1/settings/branding')
        .expect(200);

      expect(branding.body).toMatchObject({
        gymName: 'Atlas Fitness Club',
        logoUrl: 'https://cdn.example.com/logo.png',
        currency: 'MAD',
        locale: 'fr-MA',
      });
    });

    it('valide les couleurs, devises et taux de TVA', async () => {
      await http
        .put('/api/v1/settings')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ primaryColor: 'rouge' })
        .expect(400);

      await http
        .put('/api/v1/settings')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ currency: 'euro' })
        .expect(400);

      await http
        .put('/api/v1/settings')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          taxRates: [
            { label: 'TVA', rate: 20 },
            { label: 'tva', rate: 10 },
          ],
        })
        .expect(400);

      await http
        .put('/api/v1/settings')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ taxRates: [{ label: 'TVA', rate: 120 }] })
        .expect(400);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Observabilité
  // -------------------------------------------------------------------------
  describe('5. Observabilité', () => {
    it('protège l’endpoint de métriques', async () => {
      await http.get('/api/v1/observability/metrics').expect(401);
    });

    it('expose les métriques HTTP, DB et Outbox avec corrélation', async () => {
      const metrics = await http
        .get('/api/v1/observability/metrics')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('x-request-id', 'e2e-correlation-metrics')
        .expect(200);

      expect(metrics.headers['x-request-id']).toBe('e2e-correlation-metrics');
      expect(metrics.text).toContain('http_requests_total');
      expect(metrics.text).toContain('http_request_duration_ms_bucket');
      expect(metrics.text).toContain('db_transactions_total');
      expect(metrics.text).toContain('outbox_events{status=');
    });

    it('ajoute le requestId et le traceId aux erreurs HTTP', async () => {
      const traceId = 'c'.repeat(32);
      const response = await http
        .get('/api/v1/gym/subscriptions')
        .set('x-request-id', 'e2e-correlation-error')
        .set('traceparent', `00-${traceId}-${'d'.repeat(16)}-01`)
        .expect(401);

      expect(response.body.requestId).toBe('e2e-correlation-error');
      expect(response.body.traceId).toBe(traceId);
      expect(response.headers['x-trace-id']).toBe(traceId);
    });

    it('propage un traceparent W3C sur une requête authentifiée', async () => {
      const traceId = 'e'.repeat(32);
      const response = await http
        .get('/api/v1/gym/subscriptions')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('traceparent', `00-${traceId}-${'f'.repeat(16)}-01`)
        .expect(200);

      expect(response.headers['x-trace-id']).toBe(traceId);
      expect(response.headers.traceparent).toContain(traceId);
    });

    it('purge uniquement les clés d’idempotence COMPLETED expirées', async () => {
      const dataSource = app.get(DataSource);
      const scope = `e2e.retention.${Date.now()}`;

      await dataSource.query(
        `INSERT INTO idempotency_keys
          ("tenantId", "scope", "key", "requestHash", "status", "response", "createdAt", "updatedAt")
         VALUES
          ($1, $2, 'old-completed', 'hash', 'COMPLETED', '{}'::jsonb, NOW() - INTERVAL '40 days', NOW() - INTERVAL '40 days'),
          ($1, $2, 'recent-completed', 'hash', 'COMPLETED', '{}'::jsonb, NOW(), NOW()),
          ($1, $2, 'old-processing', 'hash', 'PROCESSING', NULL, NOW() - INTERVAL '40 days', NOW() - INTERVAL '40 days')`,
        [TEST_TENANT_ID, scope],
      );

      const result = await http
        .post('/api/v1/observability/retention/run')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(result.body.idempotencyKeysPurged).toBeGreaterThanOrEqual(1);

      const rows = await dataSource.query(
        'SELECT "key", "status" FROM idempotency_keys WHERE "scope" = $1 ORDER BY "key"',
        [scope],
      );

      expect(rows.map((row: { key: string }) => row.key)).toEqual([
        'old-processing',
        'recent-completed',
      ]);
    });

    it('purge uniquement les événements Outbox PROCESSED expirés', async () => {
      const dataSource = app.get(DataSource);
      const prefix = `e2e-retention-outbox-${Date.now()}`;

      await dataSource.query(
        `INSERT INTO outbox_events
          ("tenantId", "eventType", "aggregateType", "aggregateId", payload, status, attempts, "availableAt", "processedAt", "lastError", "createdAt", "updatedAt")
         VALUES
          ($1, 'test.retention', 'test', $2, '{}'::jsonb, 'PROCESSED', 1, NOW(), NOW() - INTERVAL '40 days', NULL, NOW() - INTERVAL '40 days', NOW() - INTERVAL '40 days'),
          ($1, 'test.retention', 'test', $3, '{}'::jsonb, 'PROCESSED', 1, NOW(), NOW(), NULL, NOW(), NOW()),
          ($1, 'test.retention', 'test', $4, '{}'::jsonb, 'PENDING', 0, NOW(), NULL, NULL, NOW() - INTERVAL '40 days', NOW() - INTERVAL '40 days'),
          ($1, 'test.retention', 'test', $5, '{}'::jsonb, 'PROCESSING', 1, NOW(), NULL, NULL, NOW() - INTERVAL '40 days', NOW() - INTERVAL '40 days'),
          ($1, 'test.retention', 'test', $6, '{}'::jsonb, 'FAILED', 10, NOW(), NULL, 'boom', NOW() - INTERVAL '40 days', NOW() - INTERVAL '40 days')`,
        [
          TEST_TENANT_ID,
          `${prefix}-old-processed`,
          `${prefix}-recent-processed`,
          `${prefix}-pending`,
          `${prefix}-processing`,
          `${prefix}-failed`,
        ],
      );

      const result = await http
        .post('/api/v1/observability/retention/run')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(result.body.outboxEventsPurged).toBeGreaterThanOrEqual(1);

      const rows = await dataSource.query(
        `SELECT "aggregateId", "status" FROM outbox_events
         WHERE "aggregateId" LIKE $1
         ORDER BY "aggregateId"`,
        [`${prefix}%`],
      );

      expect(
        rows
          .map((row: { aggregateId: string; status: string }) => row.status)
          .sort(),
      ).toEqual(['FAILED', 'PENDING', 'PROCESSED', 'PROCESSING']);
      expect(
        rows.some(
          (row: { aggregateId: string }) =>
            row.aggregateId === `${prefix}-old-processed`,
        ),
      ).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 5ter. Résilience
  // -------------------------------------------------------------------------
  describe('5ter. Résilience', () => {
    const suffix = Date.now();

    it('Care — deux consommations simultanées ne débitent qu’un crédit', async () => {
      const clientId = `e2e-resilience-care-${suffix}`;
      const careService = await http
        .post('/api/v1/care/services')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          title: `Pack résilience ${suffix}`,
          durationMinutes: 45,
          price: 40,
          type: 'PACK',
        })
        .expect(201);

      await http
        .post('/api/v1/care/packages/assign')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          clientId,
          careServiceId: careService.body.id,
          totalSessions: 1,
        })
        .expect(201);

      const payload = {
        clientId,
        careServiceId: careService.body.id,
        therapistId: `therapist-resilience-${suffix}`,
      };

      const [first, second] = await Promise.all([
        http
          .post('/api/v1/care/sessions/consume')
          .set('Authorization', `Bearer ${accessToken}`)
          .send(payload),
        http
          .post('/api/v1/care/sessions/consume')
          .set('Authorization', `Bearer ${accessToken}`)
          .send(payload),
      ]);

      expect([first.status, second.status].sort()).toEqual([201, 404]);

      const packages = await http
        .get(`/api/v1/care/packages/client/${clientId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(packages.body[0].remainingSessions).toBe(0);

      const sessions = await http
        .get(`/api/v1/care/sessions/client/${clientId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(sessions.body).toHaveLength(1);
    });

    it('Healthy Food — deux commandes concurrentes avec la même clé ne débitent qu’une fois', async () => {
      const ingredient = await http
        .post('/api/v1/healthy-food/ingredients')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: `Ingrédient résilience ${suffix}`,
          unit: 'UNITE',
          stockQuantity: 1,
          alertThreshold: 0,
        })
        .expect(201);

      const dish = await http
        .post('/api/v1/healthy-food/dishes')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: `Plat résilience ${suffix}`,
          price: 11,
          category: 'PLAT',
          isAvailable: true,
          type: 'SUR_COMMANDE',
        })
        .expect(201);

      await http
        .post(`/api/v1/healthy-food/dishes/${dish.body.id}/ingredients`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          ingredientId: ingredient.body.id,
          quantityNeeded: 1,
        })
        .expect(201);

      const key = `e2e-resilience-food-${suffix}`;
      const clientId = `e2e-resilience-food-client-${suffix}`;
      const payload = {
        clientId,
        type: 'SUR_PLACE',
        items: [{ dishId: dish.body.id, quantity: 1 }],
      };

      const [first, second] = await Promise.all([
        http
          .post('/api/v1/healthy-food/orders')
          .set('Authorization', `Bearer ${accessToken}`)
          .set('Idempotency-Key', key)
          .send(payload),
        http
          .post('/api/v1/healthy-food/orders')
          .set('Authorization', `Bearer ${accessToken}`)
          .set('Idempotency-Key', key)
          .send(payload),
      ]);

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(first.body.id).toBe(second.body.id);

      const ingredientAfter = await http
        .get(`/api/v1/healthy-food/ingredients/${ingredient.body.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(Number(ingredientAfter.body.stockQuantity)).toBe(0);

      const orders = await http
        .get(`/api/v1/healthy-food/orders/client/${clientId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(orders.body).toHaveLength(1);
    });

    it('Worker — récupère un événement PROCESSING orphelin', async () => {
      const dataSource = app.get(DataSource);
      const outbox = app.get(OutboxService);

      const staleDate = new Date(Date.now() - 10 * 60 * 1000);
      const inserted = await dataSource.query(
        `INSERT INTO outbox_events
          ("tenantId", "eventType", "aggregateType", "aggregateId", payload, status, attempts, "availableAt", "createdAt", "updatedAt")
         VALUES ($1, 'test.outbox.stale', 'test', $2, '{}'::jsonb, 'PROCESSING', 1, NOW(), NOW(), $3)
         RETURNING id`,
        [TEST_TENANT_ID, `stale-${suffix}`, staleDate],
      );

      const eventId = inserted[0].id;
      await outbox.processBatch();

      const event = await outbox.findById(eventId);
      expect(event?.status).toBe('PROCESSED');
      expect(event?.processedAt).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // 6. Sécurité production
  // -------------------------------------------------------------------------
  describe('6. Sécurité production', () => {
    const suffix = Date.now();

    it('partage les compteurs de rate limiting via PostgreSQL', async () => {
      const dataSource = app.get(DataSource);
      const auditService = app.get(AuthAuditService);
      const email = `e2e-distributed-rate-${suffix}@example.com`;
      const ip = '198.51.100.200';

      await dataSource.query(
        `INSERT INTO security_audit_logs (action, email, success, ip)
         SELECT 'LOGIN', $1, false, $2 FROM generate_series(1, 5)`,
        [email, ip],
      );

      expect(
        await auditService.isRateLimited(
          'LOGIN',
          { email },
          { email: 5 },
          60,
        ),
      ).toBe(true);

      expect(
        await auditService.isRateLimited(
          'LOGIN',
          { email },
          { email: 6 },
          60,
        ),
      ).toBe(false);

      expect(
        await auditService.isRateLimited(
          'LOGIN',
          { ip },
          { ip: 5 },
          60,
        ),
      ).toBe(true);
    });

    it('expose les headers de sécurité et une CORS explicite', async () => {
      const allowed = await http
        .get('/api/v1/gym/subscriptions')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Origin', 'http://localhost:5173')
        .expect(200);

      expect(allowed.headers['access-control-allow-origin']).toBe(
        'http://localhost:5173',
      );
      expect(allowed.headers['x-content-type-options']).toBe('nosniff');
      expect(allowed.headers['x-frame-options']).toBeDefined();

      const denied = await http
        .get('/api/v1/gym/subscriptions')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Origin', 'http://evil.example')
        .expect(200);

      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('rejette les champs DTO non whitelistés', async () => {
      await http
        .post('/api/v1/auth/login')
        .send({
          email: TEST_ADMIN_EMAIL,
          password: TEST_ADMIN_PASSWORD,
          hacked: true,
        })
        .expect(400);
    });

    it('rejette un JWT expiré', async () => {
      const jwtService = app.get(JwtService, { strict: false });
      const expired = jwtService.sign(
        {
          sub: 'e2e-expired',
          email: TEST_ADMIN_EMAIL,
          role: 'SUPER_ADMIN',
        },
        { expiresIn: '-1s' },
      );

      await http
        .get('/api/v1/gym/subscriptions')
        .set('Authorization', `Bearer ${expired}`)
        .expect(401);
    });

    it('limite la taille des requêtes', async () => {
      await http
        .post('/api/v1/auth/login')
        .send({
          email: TEST_ADMIN_EMAIL,
          password: 'a'.repeat(1_100_000),
        })
        .expect(413);
    });

    it('journalise les tentatives de connexion', async () => {
      const dataSource = app.get(DataSource);

      const audits = await dataSource.query(
        `SELECT action, success FROM security_audit_logs
         WHERE email = $1 AND action = 'LOGIN'`,
        [TEST_ADMIN_EMAIL],
      );

      expect(audits.some((row: { success: boolean }) => row.success)).toBe(true);
      expect(audits.some((row: { success: boolean }) => !row.success)).toBe(true);
    });

    it('applique un rate limiting sur le login', async () => {
      const statuses: number[] = [];

      for (let index = 0; index < 6; index += 1) {
        const response = await http
          .post('/api/v1/auth/login')
          .set('X-Forwarded-For', '203.0.113.77')
          .send({
            email: `rate-limit-${suffix}@example.com`,
            password: 'mot-de-passe-invalide',
          });

        statuses.push(response.status);
      }

      expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    });

    it('verrouille un compte après plusieurs échecs successifs', async () => {
      for (let index = 1; index <= 10; index += 1) {
        await http
          .post('/api/v1/auth/login')
          .set('X-Forwarded-For', `198.51.100.${index}`)
          .send({
            email: TEST_ADMIN_EMAIL,
            password: 'mot-de-passe-invalide',
          })
          .expect(401);
      }

      await http
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', '198.51.100.11')
        .send({
          email: TEST_ADMIN_EMAIL,
          password: TEST_ADMIN_PASSWORD,
        })
        .expect(429);
    });
  });
});
