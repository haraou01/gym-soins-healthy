# PHASE5_VALIDATION_REPORT

## 1. Périmètre et état

- Projet : `/Users/mohamedamineharaoubia/projects/gym-soins-healthy`
- Branche : `main`
- Dernier commit : `e458c90`
- Les changements de cette mission sont **non commités** et n'ont pas été poussés.
- Aucun test de validation n'a été exécuté sur le port `55432` ; les garde-fous refusent ce port par défaut (opt-in legacy explicite).
- Les changements non commités portent sur : `.gitignore`, tests RLS/isolation,
  `docs/load-tests.md`, `docs/operations/phase-5-validation-matrix.md`,
  `docs/operations/evidence-archive.md`,
  `docs/operations/phase5-runtime-revalidation.md`, `ops/README.md`,
  `ops/prometheus/alerts.yml`, `ops/prometheus/prometheus.staging.yml`,
  `ops/prometheus/alerts.staging-test.yml`, `scripts/validate-ops.js`, les
  garde-fous de cible, la désactivation KDS des workers, les tests unitaires,
  les workflows CI compatibles avec les garde-fous et ce rapport.
- La base `gymsoins_staging` (port `55433`) n'a pas été modifiée par les tests ; les tests ont utilisé une base isolée sur le même serveur staging.
- La revalidation runtime isolée du 2026-10-25 a utilisé uniquement
  `127.0.0.1:55433/gymsoins_p5_iso_1792965162`, puis l'a supprimée après
  archivage. Aucune connexion à `55432` ni à `gymsoins_staging`.

## 2. Audit initial

```text
git status --short --branch : main, docker-compose.staging.yml non suivi
.env.staging : présent, non suivi, ignoré par Git
docker-compose.staging.yml : contient POSTGRES_PASSWORD, non suivi
serveur staging : gymsoins-postgres-staging, healthy, 127.0.0.1:55433
base staging : gymsoins_staging
```

Action de sécurité :

- `docker-compose.staging.yml` a été ajouté à `.gitignore` sans être supprimé ni modifié ;
- `.env.staging` était déjà ignoré ;
- aucun secret n'est affiché dans ce rapport.

## 3. Intégrité du staging (lecture seule)

| Contrôle | Résultat | Statut |
|---|---|---|
| Conteneur staging | Up, healthy, port 55433 | VALIDÉ |
| Base cible | `gymsoins_staging` | VALIDÉ |
| PostgreSQL | 16.15 | VALIDÉ |
| Migrations | 29/29, identiques au dépôt | VALIDÉ |
| Tables publiques | 31 | VALIDÉ |
| Policies RLS | 45 | VALIDÉ |
| Tables `FORCE RLS` | 21 | VALIDÉ |
| Rôle `gymsoins_app` | LOGIN, non superuser, non BYPASSRLS | VALIDÉ |
| Rôle `gymsoins_worker` | LOGIN, non superuser, non BYPASSRLS | VALIDÉ |
| Rôle `gymsoins_retention` | LOGIN, non superuser, non BYPASSRLS | VALIDÉ |
| Propriétaire des tables | `gymsoins`, jamais runtime | VALIDÉ |
| Privilèges app | DML tenant-owned + tables globales autorisées | VALIDÉ |
| Privilèges worker | DML tenant-owned + Outbox global contrôlé | VALIDÉ |
| Privilèges retention | SELECT/DELETE Outbox + idempotency seulement | VALIDÉ |
| Fonctions `SECURITY DEFINER` | App/worker/retention selon fonction | VALIDÉ |

Exemples RLS observés :

```text
app sans contexte tenant        → products = 0
app avec contexte legacy        → policies appliquées
app sans contexte outbox        → outbox = 0
worker Outbox                   → accès global contrôlé
retention                       → accès global Outbox/idempotency
```

---

## 4. Tests exécutés

### E2E application + RLS

```bash
TEST_PG_HOST=127.0.0.1 \
TEST_PG_PORT=55433 \
TEST_PG_DATABASE=gymsoins_p5_iso_<timestamp> \
TEST_RESET_RUNTIME_ROLES=false \
npx jest --config ./test/jest-e2e.json --runInBand
```

Résultat :

```text
70/70 PASS
55 tests fonctionnels — rôle propriétaire explicite en test
15 tests RLS — rôle gymsoins_app
```

Preuve archivée : `artifacts/phase5/e2e-2026-10-25T22-08-32-680Z/`
(manifeste SHA-256, 70/70 PASS après correction de l'ordre d'import des
workers). La première tentative, bloquée par un mot de passe de rôle de test
incorrect, est conservée séparément dans
`artifacts/phase5/e2e-attempt1-2026-10-25T22-08-32-796Z/` ; aucun rôle n'a été
modifié ou réinitialisé.

La base isolée a été créée/réinitialisée par le runner, jamais `gymsoins_staging`.

### Build et suites disponibles

```text
Backend      : npm run build            PASS — archive build-corrections-2026-10-25T22-28-48-403Z
Frontend     : build Vite                PASS — archive frontend-2026-10-25T22-28-42-179Z
Tests unitaires : npm run test:unit — 38/38 PASS (aucune connexion DB)
                 archive unit-final-corrections-2026-10-25T22-33-14-048Z
```

### RLS et isolation

```text
SELECT direct A/B                       PASS
INSERT cross-tenant                     refusé
UPDATE/DELETE cross-tenant              refusé
changement de tenantId                  refusé
contexte absent/vide/invalide           sûr
rollback, erreur, réutilisation pool    PASS
concurrence A/B                         PASS
relations parent/enfant                 PASS
Outbox/workers/rétention                PASS
tables globales                         autorisées
schema_migrations                       refusé
désactivation RLS par app               refusée
FORCE RLS                               vérifié
```

### Smoke HTTP tous modules sous RLS

```bash
npm run verify:app-rls
```

Résultat :

```text
Gym subscription / check-in     PASS
Care                            PASS
Booking                         PASS
Maintenance                     PASS
Shop + Loyalty                  PASS
Healthy Food                    PASS
Outbox                          PASS
```

Cette exécution `verify:app-rls` est une **preuve de session non archivée** :
elle n'a pas été rejouée dans la passe de corrections, car elle nécessite une
base et une API isolées. Elle n'est pas comptée comme preuve SHA-256.

### UI navigateur

```bash
npm run verify:ui
```

Résultat :

```json
{
  "registration": true,
  "singleMembership": true,
  "tenantSelection": true,
  "tenantSwitch": true,
  "tokenReplaced": true,
  "dataIsolation": true,
  "revokedMembership": true,
  "fallbackPolling": true
}
```

Limite : Chrome local + `playwright-core`, pas encore exécuté en CI.
Preuve archivée : `artifacts/phase5/ui-2026-10-25T22-08-33-039Z/`.
L'UI a été servie sur `127.0.0.1:5174` avec `CORS_ORIGINS` dédié. Des
`consoleErrors` non bloquants (assets externes non résolus, 401/409 attendus
par le scénario) ont été observés ; le verdict du script reste PASS.

### SSE

```bash
npm run verify:kds-sse
```

Résultat :

```text
A reçoit A / B ne reçoit pas A       PASS
B reçoit B / A ne reçoit pas B       PASS
Ticket réutilisé                     HTTP 401
Ticket expiré                        HTTP 401
Reconnexion + resync                 PASS
Absence de fuite après reconnexion   PASS
Fallback REST A/B                    PASS
```

Preuve archivée : `artifacts/phase5/sse-2026-10-25T22-08-33-268Z/`.
Cette exécution prouve aussi que l'API conservait le polling KDS actif
(`kds_events_published_total` > 0).

### Charge multi-tenant

```bash
LOAD_MULTI_REQUESTS=100 LOAD_MULTI_CONCURRENCY=25 npm run load:test:multi
```

Résultat :

```text
Shop A/B           100×201 par tenant
Booking A/B        100×201 par tenant
KDS A/B            100×201 + 100×200 statuts par tenant
Outbox             600 PROCESSED
mismatches         0
```

Percentiles détaillés : `docs/load-tests.md`.

### OTel

```bash
npm run verify:otel
```

Résultat :

```text
HTTP + PostgreSQL + outbox.append + outbox.process
outboxCorrelated : true
API : gymsoins_app
Worker : gymsoins_worker
```

Preuve archivée : `artifacts/phase5/otel-2026-10-25T22-08-33-506Z/`
(124 spans, `outboxCorrelated=true`).

### Workers / multi-processus

- 2 workers Outbox simultanés : 50 événements, tous `PROCESSED`, `attempts=1`.
- 2 workers rétention simultanés : verrou advisory, états `locked` et `success` observés.
- `/health`, `/metrics`, SIGTERM : PASS.

Ces trois résultats sont des **preuves de session non archivées** : la
concurrence multi-processus n'a pas été rejouée dans la passe de corrections.
L'archive `workers-2026-10-25T22-08-34-107Z/` couvre le runtime KDS/rétention
final, pas cette concurrence.

### Audit secrets / dépendances

```text
Audit secrets : PASS — 292 fichiers suivis, 0 finding (archive audit-final-...)
npm production high/critical : PASS — 0 high, 0 critical ; gate high exit 0
npm production moderate : 6 (Nest 12 / file-type différés) ; JSON exit 1 attendu
npm global : 19 (3 low, 12 moderate, 4 high dev) — preuve de session
```

Preuve npm production : `artifacts/phase5/npm-audit-2026-10-25T22-28-42-179Z/`.
Le JSON `npm audit --omit=dev` sort en code 1 à cause des 6 vulnérabilités
modérées ; le gate CI `--audit-level=high` sort en code 0.

### CI

```text
Workflow YAML : PASS
CI locale équivalente : PASS (E2E final archivé, unit 38/38)
CI distante : BLOQUÉ (aucun remote Git)
```

La CI exécute désormais `npm run test:unit` et valide les cibles éphémères avec
`node scripts/ci-db-guard.js` avant chaque `DROP`/`CREATE`. Les bases
`gymsoins_migration_blank` et `gymsoins_restore_check` sont dans une allowlist
CI explicite ; `55432` n'est jamais autorisé globalement et `gymsoins_test`
n'est pas utilisé par la CI.

### Backup / restore

Sur la base isolée `gymsoins_p5_iso_1792965162` (port 55433) :

```text
Backup : PASS — dump 158799 octets, SHA-256 vérifié
Restore isolé : NOT RUN
Verify restore : NOT RUN
```

Le backup a été rejoué et archivé dans
`artifacts/phase5/backup-2026-10-25T22-08-33-979Z/`. Le restore exige une
**seconde base cible distincte** (`RESTORE_DATABASE`) ; cette cible n'était pas
autorisée par le périmètre (une seule base temporaire). Il n'a donc pas été
exécuté et n'est pas présenté comme PASS. Le résultat historique de restore
reste une preuve de session antérieure non rejouée.

Les scripts `restore.js`, `migrate.js`, `bootstrap-db-roles.js`, `backup.js` et
`verify-restore.js` passent maintenant par `safe-target` avant toute connexion.
`bootstrap-db-roles.js` exige en plus `ALLOW_RUNTIME_ROLE_BOOTSTRAP=true` et
n'affiche jamais les mots de passe.

---

## 5. Observabilité locale déployée

Conteneurs créés :

```text
gymsoins-prometheus-p5    prom/prometheus:v2.55.1, port 9091
gymsoins-grafana-p5       grafana/grafana:11.3.0, port 3001
```

Configuration dédiée :

```text
ops/prometheus/prometheus.staging.yml
ops/prometheus/alerts.staging-test.yml
```

Résultats réels :

| Contrôle | Résultat | Statut |
|---|---|---|
| Prometheus démarré | 2.55.1, `/-/ready` 200 | VALIDÉ snapshot |
| Cibles API/worker/rétention | 3/3 UP | VALIDÉ snapshot |
| Grafana démarré | 11.3.0, `/api/health` OK | VALIDÉ snapshot |
| Datasource Prometheus | `http://prometheus:9090` | VALIDÉ snapshot |
| Dashboard provisionné | 9 panneaux | VALIDÉ snapshot |
| Alerte test | `firing` au snapshot | VALIDÉ snapshot |
| Résolution alerte test | expression neutralisée → `inactive` | preuve de session non archivée |
| Re-déclenchement | `firing` | preuve de session non archivée |
| Faux positifs worker down | corrigés par filtre `job` | VALIDÉ code |
| Erreurs KDS du worker rétention | ancienne pile `firing` au snapshot ; runtime isolé final `inactive` | CORRIGÉ / PASS isolé |
| Alertes scrape workers | `firing` puis `inactive` après arrêt/reprise contrôlés | VALIDÉ runtime |
| Nombre d'alertes | 24 | VALIDÉ |
| Alerting externe | non configuré | BLOQUÉ |

Snapshot lecture seule : `artifacts/phase5/observability-readonly-2026-10-25T22-28-42-179Z/`.
Il montre aussi `GymSoinsKdsPollErrors` encore `firing` sur l'ancienne pile
`:3000`/`:3102`/`:3103` ; ne pas le confondre avec le runtime isolé final dont
la preuve est dans `workers-2026-10-25T22-08-34-107Z/`.

La règle `GymSoinsStagingAlertPipelineTest` est explicitement une règle de
validation locale, absente de la configuration Prometheus de production.

La pile historique (API `:3000`, workers `:3102`/`:3103`, Prometheus `:9091`,
Grafana `:3001`) n'a **pas** été rechargée ni arrêtée, afin de ne pas toucher à
la base staging principale.

La revalidation runtime a utilisé une pile isolée dédiée :

```text
API de validation : http://127.0.0.1:3200 (base isolée 55433)
Worker Outbox     : 3202
Worker rétention  : 3203
Prometheus        : 9092
Frontend Vite     : 5174
```

Résultats de cette pile isolée :

| Contrôle | Résultat | Preuve |
|---|---|---|
| API KDS actif | PASS — `kds_events_published_total` 200 + 40 | `artifacts/phase5/workers-2026-10-25T22-08-34-107Z/` |
| Workers Outbox/Retention KDS désactivé | PASS — log explicite, aucun `kds_poll_errors_total` | même archive |
| Retention opérationnelle | PASS — `retention_worker_up 1`, purge `success` | même archive |
| Targets Prometheus | PASS — API/Outbox/Retention `up` | `artifacts/phase5/prometheus-2026-10-25T22-08-34-475Z/` |
| `GymSoinsKdsPollErrors` | PASS — `inactive` | même archive |
| `GymSoinsOutboxWorkerScrapeDown` | PASS — `firing` après arrêt, `inactive` après reprise | même archive |
| `GymSoinsRetentionWorkerScrapeDown` | PASS — `firing` après arrêt, `inactive` après reprise | même archive |

La pile isolée a été arrêtée après les preuves. Le conteneur Prometheus isolé a
été supprimé ; aucun volume de base de données n'a été supprimé ou modifié.

Deux alertes non liées aux nouvelles règles restent visibles sur la base de
test : `GymSoinsOutboxFailed` (3 événements `FAILED` créés par les fixtures
E2E `test.mt.failed`/`test.retention`) et `GymSoinsBackupMetricsMissing`
(aucune métrique textfile backup exposée). Elles ne proviennent pas des règles
de scrape workers et ne sont pas des faux positifs de la correction KDS.

---

## 6. Défauts/corrections de cette mission

1. **Isolation des tests staging**
   - Le reset de base pouvait réinitialiser les mots de passe des rôles runtime
     du cluster staging.
   - Ajout de `TEST_RESET_RUNTIME_ROLES=false` et vérification des rôles sans
     modification.
   - Les tests utilisent une base isolée 55433 ; `gymsoins_staging` n'est pas
     réinitialisée.

2. **Environnement de licence staging**
   - La variable de staging pouvait activer le mode développement.
   - La suite de tests force `LICENSE_DEV_MODE=false` ; les tests de signature
     restent stricts.

3. **Faux positifs d'alertes workers**
   - `outbox_worker_up=0` et `retention_worker_up=0` sont exposés par l'API
     lorsque les workers in-process sont désactivés.
   - Les règles filtrent désormais le `job` du worker réel.
   - Vérifié dans Prometheus : les alertes worker sont repassées à `inactive`.

4. **Fuite potentielle de compose staging**
   - `docker-compose.staging.yml` contient un secret et n'était pas ignoré.
   - Ajout à `.gitignore`, fichier conservé localement.

5. **Alertes testées**
   - Règle dédiée staging, déclenchement, résolution et re-déclenchement
     observés.

6. **Polling KDS dans les workers**
   - Le worker de rétention exécutait `KdsEventsService` sans droit sur
     `list_kds_outbox_events()` ; `GymSoinsKdsPollErrors` était réellement
     `firing` avec 485 erreurs observées.
   - Ajout de `KDS_EVENTS_ENABLED` (défaut `true` pour l'API) et désactivation
     explicite dans `worker.ts` et `retention-worker.ts`.
   - Tests unitaires : service activé/désactivé, configuration des deux
     workers, purge de rétention.
   - Défaut d'ordre d'import détecté pendant la validation : les helpers
     étaient appelés après l'évaluation de `ConfigModule.forRoot()`, donc les
     flags worker n'étaient pas appliqués. Correction par modules
     d'initialisation à effet de bord importés **avant** `AppModule`
     (`outbox-worker-bootstrap.ts`, `retention-worker-bootstrap.ts`).
   - Validation runtime finale sur base isolée : **PASS** (API KDS actif,
     workers KDS désactivé, aucun `kds_poll_errors_total` sur la rétention,
     purge opérationnelle).

7. **Garde-fous de cible**
   - `gymsoins_staging` est refusée sans exception.
   - `55432` est refusé par défaut ; `ALLOW_LEGACY_TEST_DB=true` est requis
     explicitement **et** la base doit être dans l'allowlist exacte :
     `gymsoins_test`, `gymsoins_ci`, `gymsoins_backup_source` (legacy) ou
     `gymsoins_migration_blank`, `gymsoins_restore_check` (CI éphémère).
     `gymsoins_test` n'est pas utilisé par la CI.
   - Sur `55433`, tout mode non lecture (`migration`, `write`, `destructive`)
     exige le préfixe `gymsoins_p5_iso_`.
   - `restore.js`, `migrate.js`, `bootstrap-db-roles.js`, `backup.js` et
     `verify-restore.js` valident la cible avant toute connexion.
     `bootstrap-db-roles.js` exige `ALLOW_RUNTIME_ROLE_BOOTSTRAP=true`.
   - La CI exécute `npm run test:unit` et `scripts/ci-db-guard.js` avant les
     `DROP`/`CREATE` des bases éphémères.
   - `TEST_RESET_RUNTIME_ROLES` est désormais opt-in (`true` explicite) ; la CI
     ne l'active que sur les bases éphémères `gymsoins_ci` et
     `gymsoins_backup_source`, jamais sur staging/production.
   - Tests unitaires : 38/38, sans connexion DB ; archive
     `unit-final-corrections-2026-10-25T22-33-14-048Z/`.
   - Procédure de revalidation runtime :
     `docs/operations/phase5-runtime-revalidation.md`.

8. **Archivage des preuves**
   - Ajout de `scripts/archive-evidence.js` et
     `docs/operations/evidence-archive.md`.
   - Preuves historiques déjà archivées : `load-2026-10-25T20-44-04-787Z`,
     `backup-2026-10-25T20-44-04-814Z`, `workers-2026-10-25T20-44-04-840Z`,
     `unit-2026-10-25T20-50-07-205Z`, `ops-2026-10-25T20-50-07-229Z`,
     `audit-2026-10-25T20-50-07-254Z`.
   - Nouvelles preuves runtime archivées avec manifeste SHA-256 :
     - E2E : `artifacts/phase5/e2e-2026-10-25T22-08-32-680Z/` ;
     - UI : `artifacts/phase5/ui-2026-10-25T22-08-33-039Z/` ;
     - SSE : `artifacts/phase5/sse-2026-10-25T22-08-33-268Z/` ;
     - OTel : `artifacts/phase5/otel-2026-10-25T22-08-33-506Z/` ;
     - charge : `artifacts/phase5/load-2026-10-25T22-08-33-739Z/` ;
     - backup : `artifacts/phase5/backup-2026-10-25T22-08-33-979Z/` ;
     - workers/KDS : `artifacts/phase5/workers-2026-10-25T22-08-34-107Z/` ;
     - Prometheus/alertes : `artifacts/phase5/prometheus-2026-10-25T22-08-34-475Z/` ;
     - isolation DB : `artifacts/phase5/db-isolation-2026-10-25T22-08-34-352Z/` ;
     - suppression DB : `artifacts/phase5/db-cleanup-2026-10-25T22-08-45-006Z/` ;
     - vérification des manifestes : `artifacts/phase5/evidence-verify-2026-10-25T22-09-04-872Z/` ;
     - build/unit/ops/audit finaux : `artifacts/phase5/build-final-2026-10-25T22-11-10-517Z/`,
       `artifacts/phase5/unit-final-2026-10-25T22-11-10-288Z/`,
       `artifacts/phase5/ops-final-2026-10-25T22-11-10-403Z/`,
       `artifacts/phase5/audit-final-2026-10-25T22-11-10-635Z/` ;
     - corrections finales : `frontend-2026-10-25T22-28-42-179Z`,
       `unit-final-corrections-2026-10-25T22-33-14-048Z`,
       `npm-audit-2026-10-25T22-28-42-179Z`,
       `observability-readonly-2026-10-25T22-28-42-179Z`,
       `build-corrections-2026-10-25T22-28-48-403Z`,
       `evidence-verify-corrections-2026-10-25T22-28-56-171Z`,
       `evidence-verify-final2-corrections-2026-10-25T22-33-19-134Z`.
   - Les tentatives échouées (auth test, CORS, rate-limit) sont conservées
     séparément avec les labels `*-attempt1`.
   - Compte courant : **40 manifestes / 62 fichiers**. La dernière vérification
     SHA-256 a couvert 39 manifestes / 61 fichiers avant l'ajout de sa propre
     archive finale, avec 0 écart.

9. **Alertes de disponibilité**
   - Ajout de `GymSoinsOutboxWorkerScrapeDown` et
     `GymSoinsRetentionWorkerScrapeDown` pour détecter une cible absente/DOWN.

---

## 7. Résultats par statut

### VALIDÉ

- RLS PostgreSQL, rôles, policies, FORCE RLS.
- Contexte transactionnel et pool.
- Tests unitaires des garde-fous et de la désactivation KDS (38/38, preuve archivée).
- Smoke HTTP sous RLS (preuve de session non archivée).
- E2E/RLS 70/70 sur base isolée (preuve archivée).
- UI Playwright locale (preuve archivée, erreurs console non bloquantes).
- SSE KDS isolation tenant + reconnexion + fallback (preuve archivée).
- OTel API/worker/outbox corrélé (preuve archivée).
- Charge A/B, 800 requêtes, 0 erreur, invariants zéro fuite (preuve archivée).
- Backup de la base isolée (preuve archivée).
- Runtime KDS/Retention : API KDS actif, workers KDS désactivé, purge OK,
  aucun `kds_poll_errors_total` sur la rétention (preuve archivée).
- Prometheus isolé : 3 targets UP, nouvelles alertes scrape-down
  `firing`/`resolution` (preuve archivée) ; runtime isolé final
  `GymSoinsKdsPollErrors` inactive, mais snapshot de l'ancienne pile encore
  `firing` (preuve read-only archivée).
- Isolation DB : une seule base `gymsoins_p5_iso_1792965162`, supprimée après
  contrôle ; aucun accès à `55432`/`gymsoins_staging`.
- Audit secrets (292 fichiers suivis, 0 finding).
- Build backend/frontend, unit 38/38, npm audit production et snapshot
  Prometheus/Grafana : preuves archivées.

### PREUVES ARCHIVÉES

- E2E 70/70 : `artifacts/phase5/e2e-2026-10-25T22-08-32-680Z/`.
- UI navigateur locale : `artifacts/phase5/ui-2026-10-25T22-08-33-039Z/`.
- SSE : `artifacts/phase5/sse-2026-10-25T22-08-33-268Z/`.
- OTel : `artifacts/phase5/otel-2026-10-25T22-08-33-506Z/`.
- Charge : `artifacts/phase5/load-2026-10-25T22-08-33-739Z/`.
- Runtime workers/KDS : `artifacts/phase5/workers-2026-10-25T22-08-34-107Z/`.
- Prometheus/alertes : `artifacts/phase5/prometheus-2026-10-25T22-08-34-475Z/`.
- Backup : `artifacts/phase5/backup-2026-10-25T22-08-33-979Z/`.
- Build frontend : `artifacts/phase5/frontend-2026-10-25T22-28-42-179Z/`.
- Build backend corrections : `artifacts/phase5/build-corrections-2026-10-25T22-28-48-403Z/`.
- Unit corrections 38/38 : `artifacts/phase5/unit-final-corrections-2026-10-25T22-33-14-048Z/`.
- npm audit production : `artifacts/phase5/npm-audit-2026-10-25T22-28-42-179Z/`.
- Prometheus/Grafana snapshot read-only : `artifacts/phase5/observability-readonly-2026-10-25T22-28-42-179Z/`.
- Vérification SHA-256 : `artifacts/phase5/evidence-verify-final2-corrections-2026-10-25T22-33-19-134Z/`.

### ÉCHOUÉ / NON RE-VÉRIFIÉ

- `GymSoinsKdsPollErrors` était réellement `firing` avant correction ; le
  runtime final isolé ne le déclenche plus. Le snapshot de l'ancienne pile
  montre encore l'alerte `firing`.
- Le défaut d'ordre d'import des workers a été détecté puis corrigé ; preuve
  de l'échec initial dans `artifacts/phase5/workers-attempt1-2026-10-25T22-08-34-233Z/`.
- Restore/verify restore non rejoués : nécessitent une seconde base cible
  distincte non autorisée. Le backup seul est PASS.
- Smoke `verify:app-rls` et workers multi-processus : preuves de session non
  archivées, non rejouées dans la passe de corrections.
- Résolution/re-déclenchement de l'alerte de test Prometheus : preuve de
  session non archivée ; seul le snapshot `firing` est archivé.

### BLOQUÉ

- CI distante : aucun remote Git.
- Déploiement staging externe : aucune infrastructure cible.
- Alerting externe / notification : non configuré.
- Résilience API multi-hôte / load-balancer : non exécutée.

### NON TESTÉ

- Restore/verify restore sur cible distincte.
- UI Playwright en CI.
- API multi-hôte derrière load-balancer.
- Déclenchement d'une alerte métier réelle en production/staging externe.
- Smoke app RLS et workers multi-processus sur une nouvelle session archivée.

---

## 8. Risques résiduels

1. Le rôle migration/propriétaire est superuser et contourne RLS ; il ne doit jamais servir l'API.
2. Les fonctions `SECURITY DEFINER` sont des surfaces privilégiées contrôlées.
3. Les tables globales ne sont pas RLS.
4. `settings` global et email unique plateforme restent des décisions produit ouvertes.
5. La base staging `gymsoins_staging` est vide de données métier ; la validation fonctionnelle a utilisé une base isolée.
6. Les garde-fous refusent `55432` par défaut et `gymsoins_staging` sans exception ; `ALLOW_LEGACY_TEST_DB=true` exige en plus une base de l'allowlist exacte. `gymsoins_test` reste legacy et n'est pas utilisé par la CI.
7. La validation des alertes est locale, pas via Alertmanager externe.
8. Les preuves E2E/UI/SSE/OTel/charge/backup/KDS/Prometheus et les corrections finales sont archivées avec manifestes SHA-256 ; le compte courant est 40 manifestes / 62 fichiers, avec 0 écart sur la dernière vérification.
9. La correction KDS est validée en runtime isolé ; l'ancienne pile `:3000`/`:3102`/`:3103`/`:9091` n'a pas été rechargée pour ne pas toucher `gymsoins_staging` et montre encore `GymSoinsKdsPollErrors` `firing` dans le snapshot read-only.
10. Restore/verify restore restent non rejoués faute de seconde cible autorisée ; les scripts sont désormais gardés avant connexion.
11. Les alertes `GymSoinsOutboxFailed` (fixtures E2E `FAILED`) et `GymSoinsBackupMetricsMissing` restent visibles sur la pile de test ; elles ne sont pas causées par les nouvelles règles de scrape workers.

---

## 9. Étapes externes restantes

1. Configurer le remote Git et le runner CI, puis exécuter le workflow réel.
2. Fournir un staging applicatif (API/frontend/workers) et ses secrets.
3. Déployer Prometheus/Grafana/Alertmanager sur le staging externe.
4. Exécuter les smoke tests staging et un test d'alerte réel.
5. Tester une API multi-hôte derrière load-balancer.
6. Exécuter Playwright en CI ou sur un environnement navigateur dédié.

---

## 10. Décision

# CORRECTIONS APPLIQUÉES — PRÊT POUR REVUE FINALE

La revalidation runtime isolée a été exécutée le 2026-10-25 sur
`127.0.0.1:55433/gymsoins_p5_iso_1792965162` : API KDS actif, workers
Outbox/Retention sans polling KDS, rétention opérationnelle, 3 targets
Prometheus UP, nouvelles alertes scrape-down testées en `firing` puis
`resolution`, E2E 70/70, UI/SSE/OTel/charge/backup PASS. La base temporaire a
été supprimée après archivage ; `55432` et `gymsoins_staging` n'ont pas été
touchés.

Les corrections post-revue sont appliquées : garde-fou dans
`restore.js`/`migrate.js`/`bootstrap-db-roles.js`/`backup.js`/`verify-restore.js`,
allowlist CI explicite, `ci-db-guard`, `test:unit` en CI, tests unitaires
38/38 et archivage des preuves frontend/npm audit/observabilité. Les points
restants sont explicitement hors périmètre ou non exécutés : restore/verify
restore (seconde base cible non autorisée), CI distante, staging applicatif
externe, Alertmanager externe, résilience API multi-hôte, smoke app RLS et
workers multi-processus (preuves de session non archivées). Ils ne remettent pas
en cause les corrections ciblées, mais empêchent une déclaration de phase
globale totalement terminée.

## 11. Statut des corrections ciblées

# CORRECTIONS APPLIQUÉES — PRÊT POUR REVUE FINALE

Les corrections KDS, garde-fous de cible, archivage, CI et alertes de scrape
sont implémentées, couvertes par tests unitaires et validées en runtime isolé.
La procédure `docs/operations/phase5-runtime-revalidation.md` a été exécutée dans
le périmètre autorisé. Aucun commit, push ou déploiement n'a été effectué.
