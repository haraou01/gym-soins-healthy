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

Scripts automatisés :

```bash
npm run backup
RESTORE_DATABASE=gymsoins_restore_check npm run restore
RESTORE_DATABASE=gymsoins_restore_check npm run verify:restore
SMOKE_API_URL=http://127.0.0.1:3001/api/v1 \
  SMOKE_EMAIL=... SMOKE_PASSWORD=... \
  npm run smoke:restore
```

Le workflow `.github/workflows/backup-restore.yml` exécute backup → restore → migrations → vérification → smoke tests dans un environnement isolé, sur planification quotidienne.

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
4. audit des secrets ;
5. tests E2E sur PostgreSQL éphémère.

## Tests de charge

Le script `scripts/load-test.js` couvre Booking, Shop et KDS.

```bash
LOAD_SCENARIO=all \
LOAD_REQUESTS=20 \
LOAD_CONCURRENCY=10 \
LOAD_BASE_URL=http://127.0.0.1:3000/api/v1 \
LOAD_EMAIL=admin.e2e@gymsoins.local \
LOAD_PASSWORD='AdminE2E123!' \
POSTGRES_DATABASE=gymsoins_test \
npm run load:test
```

Il mesure throughput, p50/p95/p99, statuts HTTP, erreurs, conflits et un instantané des métriques Outbox/DB. Utiliser une base isolée : les données créées sont nettoyées par le script via `LOAD_CLEANUP=true` par défaut.

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

### Worker Outbox dédié

En local, l'API peut traiter l'Outbox. En production multi-instance, désactiver le worker dans l'API :

```bash
OUTBOX_WORKER_ENABLED=false
```

Puis lancer le worker dédié :

```bash
npm run build
npm run start:worker
```

Le worker expose :

- `GET http://127.0.0.1:3002/health`
- `GET http://127.0.0.1:3002/ready`
- `GET http://127.0.0.1:3002/metrics`

Il gère `SIGTERM`/`SIGINT`, reprend les `PROCESSING` orphelins et utilise PostgreSQL comme source de vérité. Redis n'est pas requis.

### Observabilité

- Logs JSON structurés avec `requestId`.
- En-tête `X-Request-Id` accepté et propagé.
- Tracing W3C : `traceparent`, `X-Trace-Id`, `traceId`/`spanId` dans les logs et les événements Outbox.
- Métriques Prometheus : `GET /api/v1/observability/metrics` (SUPER_ADMIN).
- Métriques HTTP, erreurs, DB PostgreSQL, Outbox et worker.
- Erreurs HTTP enrichies avec `requestId` et `traceId`.

### Rétention

Purge manuelle contrôlée (SUPER_ADMIN) :

```http
POST /api/v1/observability/retention/run
```

- idempotency : uniquement `COMPLETED` expirées, `FOR UPDATE SKIP LOCKED` ;
- outbox : uniquement `PROCESSED` expirés ;
- `PENDING`, `PROCESSING`, `FAILED` sont conservés ;
- purge par lots et métriques dédiées ;
- worker de purge périodique configurable.

### Sécurité HTTP

- Helmet (headers de sécurité).
- CORS explicite via `CORS_ORIGINS`.
- Limite de taille des requêtes via `REQUEST_BODY_LIMIT`.
- Rate limiting global et renforcé sur login/register.
- Verrouillage temporaire après échecs de connexion répétés.
- Audit des connexions/inscriptions dans `security_audit_logs`.
- Validation DTO stricte (`forbidNonWhitelisted`).
- `JWT_SECRET` et `LICENSE_SECRET` obligatoires (>= 32 caractères) en production.

### Refresh tokens

Le modèle actuel ne stocke pas de refresh token : l'API délivre uniquement un access token JWT. Une implémentation future devra ajouter une table de sessions, stocker un hash opaque, gérer rotation/révocation/détection de réutilisation et l'audit associé. Aucun flux JWT existant n'a été modifié.

## Rotation des secrets

Les secrets de production doivent être fournis par l'environnement, jamais par Git.

Procédure recommandée :

1. générer une nouvelle valeur aléatoire (>= 32 caractères) ;
2. mettre à jour le gestionnaire de secrets / l'environnement ;
3. redémarrer les processus API et worker ;
4. vérifier `/health`, les logs et les métriques.

Impacts :

- rotation de `JWT_SECRET` : invalide toutes les sessions JWT existantes ;
- rotation de `LICENSE_SECRET` : invalide les clés de licence signées avec l'ancien secret ;
- les dumps PostgreSQL contiennent des hashes de mots de passe : les protéger comme des secrets.

Le contrôle `npm run audit:secrets` vérifie les fichiers versionnés. Il est exécuté en CI.

## Notes de sécurité

- Aucun module métier optionnel n'importe directement un autre module métier.
- Les flux critiques utilisent des transactions et des verrous PostgreSQL.
- Les événements sont optionnels : l'absence d'un listener ne bloque pas le flux principal.
- Les secrets doivent être fournis par l'environnement, jamais commités.
