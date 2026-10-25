import { createHmac } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import {
  getTestDatabaseSettings,
  resetTestDatabase,
  TEST_ADMIN_EMAIL,
  TEST_ADMIN_PASSWORD,
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
    delete process.env.LICENSE_KEY;
    delete process.env.LICENSE_HARDWARE_ID;

    await waitForDatabase(database);
    await resetTestDatabase(database);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    // Même configuration que `src/main.ts`.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: false,
        transform: true,
      }),
    );
    await app.init();

    http = request(app.getHttpServer());
  }, 180_000);

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
      const payload = jwtService.verify<{ sub: string; email: string; role: string }>(
        response.body.access_token,
      );

      expect(payload.sub).toBe(response.body.user.id);
      expect(payload.email).toBe(TEST_ADMIN_EMAIL);
      expect(payload.role).toBe('SUPER_ADMIN');

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

      const jwtService = app.get(JwtService, { strict: false });
      const receptionistToken = jwtService.sign({
        sub: 'e2e-receptionist',
        email: 'receptionist.e2e@gymsoins.local',
        role: 'RECEPTIONIST',
        permissions: [],
      });

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
});
