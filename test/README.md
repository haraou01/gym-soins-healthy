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
# Legacy local uniquement : opt-in explicite pour 55432.
# Base déjà bootstrappée avec les rôles runtime :
ALLOW_LEGACY_TEST_DB=true npm run test:e2e

# Legacy local, base neuve : reset explicite des rôles de test uniquement.
# La CI n'active ce reset que sur les bases éphémères gymsoins_ci et
# gymsoins_backup_source ; jamais sur staging/production.
ALLOW_LEGACY_TEST_DB=true TEST_RESET_RUNTIME_ROLES=true npm run test:e2e

# Cible staging isolée autorisée (55433, jamais gymsoins_staging)
TEST_PG_HOST=127.0.0.1 \
TEST_PG_PORT=55433 \
TEST_PG_DATABASE=gymsoins_p5_iso_<timestamp> \
TEST_RESET_RUNTIME_ROLES=false \
npm run test:e2e

# Tests unitaires sans base (38/38, dont les garde-fous de cible)
npm run test:unit
```

La suite :

1. valide la cible (hôte, port, base, mode) avant toute connexion ;
2. refuse `gymsoins_staging`, le port `55432` sans `ALLOW_LEGACY_TEST_DB=true`,
   et toute base non lecture non isolée sur `55433` ;
3. attend que PostgreSQL réponde (`waitForDatabase`) ;
4. supprime puis recrée la base de test autorisée ;
5. applique `src/database/migrations/*.sql` dans l'ordre ;
6. insère les 5 rôles RBAC et le compte `admin.e2e@gymsoins.local` ;
7. démarre l'application NestJS avec le même `ValidationPipe` que `src/main.ts`.

## Variables d'environnement

Valeurs par défaut historiques (volontairement refusées par le garde-fou) :

| Variable | Défaut |
|----------|--------|
| `TEST_PG_HOST` | `localhost` |
| `TEST_PG_PORT` | `55432` |
| `TEST_PG_USER` | `gymsoins` |
| `TEST_PG_PASSWORD` | `gymsoins` |
| `TEST_PG_ADMIN_DB` | `postgres` |
| `TEST_PG_DATABASE` | `gymsoins_test` |
| `TEST_RESET_RUNTIME_ROLES` | `false` |

Pour utiliser un PostgreSQL existant, exportez ces variables puis lancez `npm run test:e2e`.
Le port `55432` exige `ALLOW_LEGACY_TEST_DB=true` **et** une base de l'allowlist
exacte : `gymsoins_test`, `gymsoins_ci`, `gymsoins_backup_source` (legacy) ou
`gymsoins_migration_blank`, `gymsoins_restore_check` (CI éphémère). Aucune autre
base n'est acceptée. `gymsoins_test` reste legacy et n'est pas utilisé par la CI.
Une cible `55433` en mode migration/écriture/destructif doit être préfixée
`gymsoins_p5_iso_`.

Les scripts `restore.js`, `migrate.js`, `bootstrap-db-roles.js`, `backup.js` et
`verify-restore.js` appliquent le même garde-fou avant toute connexion. La CI
valide aussi les bases éphémères avec `node scripts/ci-db-guard.js` avant chaque
`DROP`/`CREATE`.

> La base de test est **supprimée puis recréée** à chaque exécution : ne pointez jamais
> `TEST_PG_DATABASE` vers une base contenant des données utiles. `gymsoins_staging`
> est refusée sans exception.

## Structure

```
test/
├── integration.e2e-spec.ts     # scénarios E2E ordonnés
├── target-guard.unit-spec.ts   # garde-fou safe-target
├── db-target-policies.unit-spec.ts # politiques restore/migrate/bootstrap
├── jest-e2e.json               # configuration Jest + ts-jest
└── utils/
    └── test-database.ts        # reset DB, migrations, seed rôles + admin
scripts/lib/db-target-policies.js # garde-fou des scripts opérationnels
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
