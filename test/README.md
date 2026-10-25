# Tests d'intégration E2E — GymSoinsHealthy

Suite Supertest/Jest qui démarre l'application NestJS réelle (`AppModule`) sur une base
PostgreSQL dédiée, applique toutes les migrations SQL, puis valide les parcours critiques
de bout en bout.

## Ce qui est vérifié

| # | Domaine | Scénario |
|---|---------|----------|
| 1 | Auth & sécurité | Mauvais mot de passe → `401` ; login `SUPER_ADMIN` → JWT signé et vérifiable |
| 2 | Licence Plug-and-Play | Licence `all` signée HMAC → 7 modules ; matériel différent → `401` ; signature falsifiée → `401` |
| 3 | Gym | Création d'un abonnement `MENSUEL` actif → `check-in` `QR_CODE` autorisé |
| 4 | Shop | Vente POS de 2 produits (25 €) → stock physique `10 → 8`, total et prix unitaire exacts |
| 5 | Loyalty | Crédit automatique de 25 points (1 pt/€), transaction `GAIN_ACHAT` liée à la vente |
| 6 | Healthy Food | Recette (150 g/pers) → commande 2 pers. → stock `1000 → 700` g |
| 7 | Healthy Food | Commande de 10 pers. avec 700 g → `400` rupture, stock inchangé (rollback) |
| 8 | Healthy Food | Transitions KDS valides `EN_ATTENTE → EN_PREPARATION → PRET` ; retour arrière refusé |

## Prérequis

- Node.js ≥ 20
- Docker + Docker Compose (pour PostgreSQL de test)

## Exécution

```bash
# 1. Démarrer PostgreSQL de test (port 55432, base recréée à chaque run)
npm run db:test:up

# 2. Lancer la suite
npm run test:e2e

# 3. Arrêter et supprimer le conteneur
npm run db:test:down
```

La suite :

1. attend que PostgreSQL réponde (`waitForDatabase`) ;
2. supprime puis recrée la base `gymsoins_test` ;
3. applique `src/database/migrations/*.sql` dans l'ordre ;
4. insère les 5 rôles RBAC et le compte `admin.e2e@gymsoins.local` ;
5. démarre l'application NestJS avec le même `ValidationPipe` que `src/main.ts`.

## Variables d'environnement

Toutes optionnelles, valeurs par défaut alignées sur `docker-compose.test.yml` :

| Variable | Défaut |
|----------|--------|
| `TEST_PG_HOST` | `localhost` |
| `TEST_PG_PORT` | `55432` |
| `TEST_PG_USER` | `gymsoins` |
| `TEST_PG_PASSWORD` | `gymsoins` |
| `TEST_PG_ADMIN_DB` | `postgres` |
| `TEST_PG_DATABASE` | `gymsoins_test` |

Pour utiliser un PostgreSQL existant, exportez ces variables puis lancez `npm run test:e2e`
(sans `db:test:up`).

> La base de test est **supprimée puis recréée** à chaque exécution : ne pointez jamais
> `TEST_PG_DATABASE` vers une base contenant des données utiles.

## Structure

```
test/
├── integration.e2e-spec.ts     # scénarios E2E ordonnés
├── jest-e2e.json               # configuration Jest + ts-jest
└── utils/
    └── test-database.ts        # reset DB, migrations, seed rôles + admin
docker-compose.test.yml         # PostgreSQL 16 éphémère (tmpfs)
```

## Notes d'architecture validées par la suite

- **Auth réelle** : `users`/`roles` en base, mots de passe `bcrypt`, JWT HS256 (`JwtModule`).
- **Licence** : `GET /api/v1/license/features` renvoie les modules autorisés ; la clé et
  l'empreinte peuvent venir des en-têtes `x-license-key` / `x-hardware-id` ou de
  `LICENSE_KEY` / `LICENSE_HARDWARE_ID`.
  **Mode développement** : avec `NODE_ENV=development` (ou `LICENSE_DEV_MODE=true`) et
  aucune clé configurée, l'endpoint renvoie les 7 modules. Dès qu'une clé est fournie,
  elle reste validée strictement (signature, matériel, expiration). La suite E2E tourne
  en `NODE_ENV=test`, donc ce mode y est désactivé.
- **Vente + fidélité atomiques** : le crédit de points est exécuté dans la **même
  transaction** que la vente (via `EntityManager` partagé), donc tout ou rien.
- **Stocks** : la décrémentation shop et healthy food utilise `SELECT ... FOR UPDATE`
  et un rollback complet en cas de rupture.
