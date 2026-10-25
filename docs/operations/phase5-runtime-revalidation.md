# Phase 5 — procédure de revalidation runtime isolée

Cette procédure a été exécutée le **2026-10-25** sur la base isolée
`127.0.0.1:55433/gymsoins_p5_iso_1792965162`, puis la base a été supprimée
après archivage. `55432` et `gymsoins_staging` n'ont pas été utilisés. Elle
reste documentée pour toute nouvelle exécution, qui doit être validée par
l'opérateur avant toute connexion à PostgreSQL.

## 1. Cible

- serveur : `gymsoins-postgres-staging`, `127.0.0.1:55433` ;
- base : `gymsoins_p5_iso_<timestamp>` uniquement ;
- interdits : `gymsoins_staging`, port `55432`, reset des rôles runtime ;
- `TEST_RESET_RUNTIME_ROLES` reste absent ou `false`.

Le garde-fou doit être vérifié avant de lancer une suite :

```bash
node - <<'NODE'
const { assertSafeTestTarget, displayTarget } = require('./scripts/lib/safe-target');
const target = assertSafeTestTarget({
  host: '127.0.0.1',
  port: 55433,
  database: 'gymsoins_p5_iso_<timestamp>',
  mode: 'destructive',
});
console.log(displayTarget(target));
NODE
```

La commande doit afficher uniquement `host:port/database`, sans secret.

Les scripts `restore.js`, `migrate.js`, `bootstrap-db-roles.js`, `backup.js` et
`verify-restore.js` utilisent le même garde-fou avant toute connexion. Sur
`55433`, **tout mode non lecture** exige le préfixe `gymsoins_p5_iso_`.
`bootstrap-db-roles.js` exige en plus
`ALLOW_RUNTIME_ROLE_BOOTSTRAP=true` et ne doit jamais être exécuté contre
`gymsoins_staging`. Le port `55432` exige `ALLOW_LEGACY_TEST_DB=true` et une
base de l'allowlist exacte ; il n'est pas utilisé par cette procédure.

## 2. Vérification KDS des workers

Charger `.env.staging` sans l'afficher, puis démarrer l'API et les workers sur
la base isolée, avec des ports dédiés :

```bash
set -a
source .env.staging
set +a

export POSTGRES_HOST=127.0.0.1
export POSTGRES_PORT=55433
export POSTGRES_DATABASE=gymsoins_p5_iso_<timestamp>

# API : KDS activé par défaut
KDS_EVENTS_ENABLED=true PORT=3000 npm run start:prod

# Worker Outbox : helper force KDS_EVENTS_ENABLED=false
WORKER_HEALTH_PORT=3102 npm run start:worker

# Worker rétention : helper force KDS_EVENTS_ENABLED=false.
# Intervalle court uniquement pour observer la purge sur la base isolée.
RETENTION_WORKER_HEALTH_PORT=3103 RETENTION_PURGE_INTERVAL_MS=2000 \
  npm run start:retention
```

Contrôles attendus :

```text
GET http://127.0.0.1:3000/internal/metrics
  → kds_events_published_total présent si des événements existent

GET http://127.0.0.1:3102/metrics
  → aucun kds_poll_errors_total

GET http://127.0.0.1:3103/metrics
  → retention_worker_up 1
  → aucun kds_poll_errors_total
```

Si `kds_poll_errors_total` apparaît sur `3103`, la correction n'est pas validée :
arrêter et analyser avant de continuer.

## 3. Suites à rejouer et archiver

Pour chaque suite, rediriger la sortie vers `/tmp`, puis archiver avec
`npm run evidence:archive`.

```bash
TEST_PG_HOST=127.0.0.1 \
TEST_PG_PORT=55433 \
TEST_PG_DATABASE=gymsoins_p5_iso_<timestamp> \
TEST_RESET_RUNTIME_ROLES=false \
npx jest --config ./test/jest-e2e.json --runInBand 2>&1 | tee /tmp/p5-e2e-revalidation.log

npm run evidence:archive -- --label e2e --source /tmp/p5-e2e-revalidation.log
```

Répéter pour :

- UI : `npm run verify:ui`, archive `ui` ;
- SSE : `npm run verify:kds-sse`, archive `sse` ;
- charge : `npm run load:test:multi`, archive `load` ;
- OTel : `npm run verify:otel`, archive `otel` ;
- backup : `npm run backup`, archive `backup` ;
- restore/verify restore : `npm run restore`, `npm run verify:restore` **uniquement**
  avec une seconde base cible autorisée ; non exécutés le 2026-10-25.

Chaque script doit afficher `[safe-target]` avant ses écritures. Une cible
`gymsoins_staging` ou `55432` doit provoquer un arrêt immédiat.

## 4. Critères de sortie

- `kds_poll_errors_total` absent sur le worker rétention ;
- `retention_worker_up 1` et purge fonctionnelle ;
- 70/70 E2E, UI/SSE/charge/OTel/backup rejoués et archivés ;
- aucun mismatch cross-tenant ;
- alertes `GymSoinsOutboxWorkerScrapeDown` et
  `GymSoinsRetentionWorkerScrapeDown` testées par arrêt contrôlé d'une cible ;
- rapport mis à jour avec chemins et SHA-256 des archives.

## 5. Résultat de l'exécution 2026-10-25

```text
E2E/RLS                  : 70/70 PASS
UI/SSE/OTel/charge       : PASS, archives SHA-256
API KDS                  : kds_events_published_total 200 + 40
Workers Outbox/Retention : KDS désactivé, aucun kds_poll_errors_total
Rétention                : retention_worker_up 1, purge success
Prometheus/Grafana       : 3 cibles UP, snapshot lecture seule archivé
Restore/verify restore   : NOT RUN (seconde base cible non autorisée)
Base isolée              : supprimée après archivage
```

Les preuves sont listées dans `docs/operations/evidence-archive.md`. Le smoke
`verify:app-rls` et la résilience workers multi-processus restent des preuves de
session non archivées.

## 6. Autorisation

Toute nouvelle exécution nécessite une confirmation explicite, car elle crée
une base isolée, écrit des fixtures et redémarre des processus applicatifs.
