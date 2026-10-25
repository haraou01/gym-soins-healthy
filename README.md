# GymSoinsHealthy

Application modulaire de gestion pour salle de sport, soins, réservations, boutique, fidélité et restauration healthy.

## Stack

- **Backend** : NestJS 10, TypeORM, PostgreSQL, JWT/Passport, EventEmitter2
- **Frontend** : React, Vite, TypeScript, Tailwind CSS
- **Desktop** : Tauri 2
- **Tests** : Jest + Supertest (E2E)

## Modules

```text
gym          Abonnements et contrôle d'accès
care         Soins, packs et consommation de séances
maintenance  Équipements, incidents et préventives
booking      Réservations et anti-double-booking
shop         Produits, stocks et point de vente
loyalty      Comptes et mouvements de points
healthy_food Ingrédients, plats, recettes et KDS
settings     Branding, thème et configuration
auth         JWT, rôles et permissions
```

Les modules optionnels sont découplés par événements (`sale.completed`, `kitchen.order.created`) et ne possèdent pas de FK croisées bloquantes.

## Prérequis

- Node.js 20+
- PostgreSQL 16+
- Docker (recommandé pour la base de test)
- Rust/Tauri CLI uniquement pour le build desktop

## Démarrage rapide

```bash
cp .env.example .env
# Adapter les variables PostgreSQL

npm ci
npm run db:migrate
npm run start:dev
```

Frontend :

```bash
cd client/src-frontend
npm ci
npm run dev
```

- API : `http://localhost:3000`
- Vite : `http://localhost:5173`

## Variables d'environnement

Le backend charge `.env` à la racine. Les variables principales sont documentées dans `.env.example` :

- `POSTGRES_*` : connexion PostgreSQL
- `JWT_*` : signature des jetons
- `LICENSE_*` : licence et mode développement
- `REDIS_*` : files Bull
- `PORT` : port HTTP

En développement local, `LICENSE_DEV_MODE=true` débloque les 7 modules. En production, la validation de licence reste obligatoire même si ce flag est présent.

Ne jamais versionner `.env` ni de secret réel.

## Migrations

```bash
npm run db:migrate
```

Le runner :

- applique les fichiers `src/database/migrations/*.sql` dans l'ordre ;
- enregistre chaque migration dans `schema_migrations` ;
- exécute chaque fichier dans une transaction.

Pour une base **déjà existante** créée avant l'introduction de `schema_migrations` :

```bash
npm run db:migrate:baseline
```

Cette commande marque les migrations présentes comme déjà appliquées sans les rejouer. À utiliser une seule fois, après vérification manuelle du schéma.

## Sauvegarde et restauration

Sauvegarde logique :

```bash
mkdir -p backups
pg_dump -Fc \
  -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" \
  -U "$POSTGRES_USERNAME" \
  "$POSTGRES_DATABASE" \
  > "backups/gymsoins_$(date +%Y%m%d_%H%M%S).dump"
```

Restauration dans une base vide :

```bash
pg_restore \
  -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" \
  -U "$POSTGRES_USERNAME" \
  -d "$POSTGRES_DATABASE" \
  --clean --if-exists \
  backups/gymsoins_YYYYMMDD_HHMMSS.dump
```

Les fichiers de sauvegarde sont ignorés par Git. Tester impérativement une restauration avant toute mise en production.

## Tests

Démarrer PostgreSQL de test :

```bash
npm run db:test:up
```

Lancer les E2E sur une base isolée :

```bash
TEST_PG_DATABASE=gymsoins_e2e npm run test:e2e
```

> Les tests recréent entièrement la base cible. Ne jamais utiliser une base de production.

Builds :

```bash
npm run build
cd client/src-frontend && npm run build
```

## CI

Le workflow `.github/workflows/ci.yml` exécute :

1. installation backend et frontend ;
2. build NestJS ;
3. typecheck + build Vite ;
4. tests E2E sur PostgreSQL éphémère.

## Licence Plug-and-Play

- Endpoint public : `GET /api/v1/license/features`
- En développement : les 7 modules sont retournés par défaut.
- En production : clé, empreinte matérielle et signature sont validées.
- Frontend : `useLicense()`, `LicenseGate` et `FeatureGate` conditionnent les pages et widgets optionnels.

## Desktop Tauri

Le projet Tauri se trouve dans `client/`. Le build desktop nécessite Rust et la CLI Tauri :

```bash
cd client
npm install
npm run build
```

## Durcissement production

### Idempotence

Les opérations critiques acceptent un header :

```http
Idempotency-Key: <valeur unique>
```

Endpoints concernés :

- `POST /api/v1/shop/sales`
- `POST /api/v1/shop/sales/process`
- `POST /api/v1/care/sessions/consume`
- `POST /api/v1/healthy-food/orders`

La clé, l'opération métier et le résultat sont commités dans la même transaction PostgreSQL. Une même clé avec un payload différent retourne `409 Conflict`.

### Outbox transactionnelle

Les événements critiques (`sale.completed`, `kitchen.order.created`) sont écrits dans `outbox_events` dans la transaction métier. Un worker PostgreSQL traite les événements avec `FOR UPDATE SKIP LOCKED`, retries et backoff.

Endpoints d'exploitation (SUPER_ADMIN) :

- `GET /api/v1/outbox/stats`
- `GET /api/v1/outbox/failed`
- `POST /api/v1/outbox/:id/retry`

Le worker est configurable via les variables `OUTBOX_*` et ne dépend pas de Redis.

### Observabilité

- Logs JSON structurés avec `requestId`.
- En-tête `X-Request-Id` accepté et propagé.
- Métriques Prometheus : `GET /api/v1/observability/metrics` (SUPER_ADMIN).
- Métriques HTTP, erreurs, DB PostgreSQL, Outbox et worker.
- Erreurs HTTP enrichies avec `requestId`.

### Sécurité HTTP

- Helmet (headers de sécurité).
- CORS explicite via `CORS_ORIGINS`.
- Limite de taille des requêtes via `REQUEST_BODY_LIMIT`.
- Rate limiting global et renforcé sur login/register.
- Verrouillage temporaire après échecs de connexion répétés.
- Audit des connexions/inscriptions dans `security_audit_logs`.
- Validation DTO stricte (`forbidNonWhitelisted`).
- `JWT_SECRET` et `LICENSE_SECRET` obligatoires (>= 32 caractères) en production.

## Notes de sécurité

- Aucun module métier optionnel n'importe directement un autre module métier.
- Les flux critiques utilisent des transactions et des verrous PostgreSQL.
- Les événements sont optionnels : l'absence d'un listener ne bloque pas le flux principal.
- Les secrets doivent être fournis par l'environnement, jamais commités.
