# Phase 5 — matrice de validation RLS et SaaS

Date : 2026-10-25  
Environnement local : macOS, Node v22.14.0, PostgreSQL 16.15 (Docker), API locale.  
Rôles :

```text
propriétaire/migration : gymsoins (superuser local)
API                     : gymsoins_app
worker Outbox           : gymsoins_worker
worker rétention        : gymsoins_retention
```

## 1. RLS — modèle et policies

| Critère | Statut | Preuve | Commande / exécution | Risque résiduel |
|---|---|---|---|---|
| Audit RLS et tables tenant-owned | PASS | 21 tables inventoriées, 10 globales | `docs/architecture/rls-design.md` | décisions produit globales |
| Rôles runtime non superuser | PASS | `rolsuper=false`, `rolbypassrls=false` pour app/worker/retention | test RLS | bootstrap mot de passe requis |
| Rôle API non propriétaire | PASS | `gymsoins_app` n'est propriétaire d'aucune table | `pg_class.relowner` | migration owner superuser |
| `FORCE ROW LEVEL SECURITY` | PASS | 21 tables, 45 policies, 21 `relforcerowsecurity=true` | `pg_class`, `pg_policies` | owner/superuser bypass attendu |
| Policies SELECT/INSERT/UPDATE/DELETE | PASS | A/B sur products, outbox, idempotency, tickets | `test/rls.e2e-spec.ts` | — |
| Contexte absent | PASS | 0 ligne, INSERT refusé | test RLS | — |
| Contexte vide | PASS | 0 ligne | test RLS | — |
| Contexte invalide | PASS | erreur PostgreSQL `22P02` | test RLS | — |
| Changement de `tenantId` | PASS | `42501` | test RLS | — |
| Relations parent/enfant | PASS | FK composite cross-tenant refusée | test RLS | — |
| Runtime ne peut pas désactiver RLS | PASS | `row_security=off` + SELECT → `42501`; `ALTER TABLE` → `42501`; `SET ROLE` refusé | test RLS | — |
| Accès SQL direct cross-tenant | PASS | SELECT/INSERT/UPDATE/DELETE B depuis A refusés | test RLS | — |

## 2. Contexte transactionnel / pool

| Critère | Statut | Preuve | Commande |
|---|---|---|---|
| `SET LOCAL` / `set_config(..., true)` | PASS | driver `pg` patché, contexte sur la même connexion/transaction | `src/core/database/rls-query-guard.ts` |
| Commit / rollback | PASS | contexte réinitialisé, A puis B sans fuite | `test/rls.e2e-spec.ts` |
| Erreur SQL puis réutilisation | PASS | rollback + nouvelle transaction valide | test RLS |
| Réutilisation séquentielle pool | PASS | pool max=1, A puis B | test RLS |
| Concurrence A/B pool | PASS | transactions concurrentes A/B, chacune 1 ligne | test RLS |
| Absence de contexte | PASS | aucune ligne tenant-owned | test RLS |
| Session persistante | PASS | aucun `SET` de session pour le tenant | revue code / test |

## 3. Workers / Outbox / rétention

| Critère | Statut | Preuve | Commande |
|---|---|---|---|
| App Outbox tenant-scoped | PASS | app contexte A voit 2 events, pas B | test RLS |
| Worker Outbox global contrôlé | PASS | worker voit les events multi-tenant | test RLS |
| Worker business tenant-scoped | PASS | worker contexte B voit product B uniquement | test RLS |
| Rétention globale contrôlée | PASS | retention voit/delete outbox, pas products | test RLS |
| Worker rétention réel | PASS (runtime) | `/health`, métriques, purge via fonctions ; polling KDS désactivé | `artifacts/phase5/workers-2026-10-25T22-08-34-107Z/` |
| Purge rétention API sous RLS | PASS | `idempotencyKeysPurged=1`, `outboxEventsPurged=1` | endpoint retention |
| Liste Outbox KDS multi-tenant | PASS | fonction `list_kds_outbox_events` | test RLS + SSE |
| Ticket SSE sans contexte préalable | PASS | fonction `consume_kds_stream_ticket` | test RLS + SSE |
| Worker `/metrics` sous rôle worker | PASS | `outbox_worker_up 1`, `outbox_events` agrégés | worker role + `outbox_stats_global` |
| Retention `/metrics` sous rôle retention | PASS | `retention_worker_up 1`, `outbox_events` agrégés | retention role |
| Worker rétention sans polling KDS | PASS (runtime) | `KDS_EVENTS_ENABLED=false` avant `AppModule`; log « Polling KDS désactivé » | `artifacts/phase5/workers-2026-10-25T22-08-34-107Z/` |
| Worker rétention — absence runtime d'erreurs KDS | PASS | aucun `kds_poll_errors_total` sur `:3203` après 170 s et redémarrages | même archive |
| API `/internal/metrics` sous rôle app | PASS | `outbox_stats_global` accessible, pas de lecture directe globale | app role |

## 4. Validation applicative complémentaire

> Les preuves UI/E2E de cette section sont archivées avec manifestes SHA-256.

| Critère | Statut | Preuve | Commande |
|---|---|---|---|
| E2E fonctionnels existants | PASS | 55/55, app rôle propriétaire | `artifacts/phase5/e2e-2026-10-25T22-08-32-680Z/` |
| E2E RLS PostgreSQL réel | PASS | 15/15, rôle `gymsoins_app`, base isolée 55433 | même archive |
| Total E2E | PASS | 70/70 sur `gymsoins_p5_iso_1792965162` | `TEST_PG_PORT=55433 TEST_PG_DATABASE=gymsoins_p5_iso_1792965162 npx jest` |
| Tests unitaires garde-fous/KDS | PASS | 38/38, aucune connexion DB ; archive `artifacts/phase5/unit-final-corrections-2026-10-25T22-33-14-048Z/` | `npm run test:unit` |
| App role — tous modules HTTP | PASS (preuve de session non archivée) | Gym, Care, Booking, Maintenance, Shop, Loyalty, Healthy Food, Outbox | `npm run verify:app-rls` |
| Inscription premier admin navigateur | PASS (preuve archivée) | tenant créé + dashboard | `npm run verify:ui` |
| Login une adhésion | PASS (preuve archivée) | dashboard | `verify:ui` |
| Login multi-adhésions | PASS (preuve archivée) | sélecteur `TENANT_SELECTION_REQUIRED` | `verify:ui` |
| Switch tenant | PASS (preuve archivée) | token remplacé, reload | `verify:ui` |
| Isolation données UI | PASS (preuve archivée) | produit A absent après switch B | `verify:ui` |
| Adhésion révoquée | PASS (preuve archivée) | 401 + retour login | `verify:ui` |
| Navigateur réel | PASS local (preuve archivée) | Chrome + `playwright-core` | `npm run verify:ui` |
| UI en CI | NOT-TESTED | Chrome/Vite absents du workflow | à planifier |

## 5. SSE

> Les preuves SSE de cette section sont archivées avec manifeste SHA-256 :
> `artifacts/phase5/sse-2026-10-25T22-08-33-268Z/`.

| Critère | Statut | Preuve | Commande |
|---|---|---|---|
| SSE A/B initial | PASS (preuve archivée) | A reçoit A, B ne reçoit pas A | `npm run verify:kds-sse` |
| Ticket réutilisé | PASS (preuve archivée) | HTTP 401 | `verify:kds-sse` |
| Ticket expiré | PASS (preuve archivée) | HTTP 401 | `verify:kds-sse` |
| Reconnexion nouveau ticket | PASS (preuve archivée) | `resync` + nouveaux events | `verify:kds-sse` |
| Absence de fuite après reconnexion | PASS (preuve archivée) | A ne reçoit pas B et inversement | `verify:kds-sse` |
| Fallback REST | PASS (preuve archivée) | listes A/B isolées | `verify:kds-sse` |
| Fallback navigateur | PASS (preuve archivée) | SSE bloqué, UI affiche le fallback polling et reste utilisable | `npm run verify:ui` |

## 6. Charge multi-tenant

| Critère | Statut | Preuve | Commande |
|---|---|---|---|
| Charge A/B concurrente | PASS | 8 scénarios, 2 tenants, 100 req/tenant, concurrence 25, staging isolé 55433 | `LOAD_MULTI_REQUESTS=100 LOAD_MULTI_CONCURRENCY=25 npm run load:test:multi` |
| Booking A/B | PASS | 100×201/tenant, p95 A 139 ms / B 169 ms | `artifacts/phase5/load-2026-10-25T22-08-33-739Z/` |
| Shop A/B | PASS | 100×201/tenant, p95 A 688 ms / B 819 ms | même archive |
| KDS A/B | PASS | 100×201/tenant + 100×200 statuts | même exécution |
| Outbox | PASS | 600 PROCESSED, 0 mismatch | même exécution |
| Invariant données | PASS | 0 ligne cross-tenant détectée | même exécution |
| Résilience workers multi-processus | PASS (preuve de session non archivée) | 2 workers Outbox, 50 events, attempts=1 ; 2 workers rétention, lock advisory | staging isolé 55433, non rejoué dans la passe corrections |
| Résilience API multi-hôte / load-balancer | NOT-TESTED | une seule API locale | staging externe / LB requis |

Détail p50/p95/p99 : `docs/load-tests.md`.

## 7. Migrations, backup, OTel

> Les preuves OTel de cette section sont archivées avec manifeste SHA-256 :
> `artifacts/phase5/otel-2026-10-25T22-08-33-506Z/`.

| Critère | Statut | Preuve | Commande |
|---|---|---|---|
| Garde-fou scripts/CI | PASS | `restore`, `migrate`, `bootstrap-db-roles`, `backup`, `verify-restore` passent par `safe-target` ; `ci-db-guard` avant les commandes CI ; 38/38 unitaires | `scripts/lib/db-target-policies.js`, `test/db-target-policies.unit-spec.ts` |
| Migrations base vierge | PASS | 29/29, 31 tables | `npm run db:migrate` |
| Second passage | PASS | 0/29 | `npm run db:migrate` |
| RLS policies sur base vierge | PASS | 21 tables FORCE, 45 policies | SQL `pg_class`/`pg_policies` |
| Migration historique | PASS | données Phase 4 backfillées, aucun NULL | comptages SQL |
| Backup/restore | PASS partiel | backup PASS (dump + SHA-256) ; restore/verify NOT RUN, seconde base cible non autorisée | `artifacts/phase5/backup-2026-10-25T22-08-33-979Z/` |
| OTel SDK/OTLP | PASS (preuve archivée) | HTTP + PG + outbox.append + outbox.process corrélés | `npm run verify:otel` |
| OTel avec rôles app/worker | PASS (preuve archivée) | app `gymsoins_app`, worker `gymsoins_worker` | `verify:otel` |

## 8. Sécurité / dépendances / secrets

| Critère | Statut | Preuve | Commande |
|---|---|---|---|
| Audit secrets | PASS | 292 fichiers, 0 finding | `npm run audit:secrets` |
| npm production high/critical | PASS | 0 high, 0 critical ; gate high exit 0 | `npm audit --omit=dev --audit-level=high`, archive `artifacts/phase5/npm-audit-2026-10-25T22-28-42-179Z/` |
| npm production moderate | PASS partiel | 6 moderate, Nest 12 différé ; JSON exit 1 attendu | même archive |
| npm global | PASS partiel | 19 total, 4 high dev | `npm audit` (session) |
| Mot de passe runtime dans Git | PASS | secrets uniquement via env/bootstrap | audit |
| Password hash API | PASS | `/tenant/members` mappe des champs sûrs | E2E |

## 9. CI / staging / observabilité déployée

| Critère | Statut | Preuve | Dépendance |
|---|---|---|---|
| CI workflow défini | PASS | YAML valide ; `test:unit` ajouté ; `ci-db-guard` avant les `DROP/CREATE` CI | `.github/workflows/ci.yml` |
| CI locale équivalente | PASS | build backend/frontend, unit 38/38, 70 E2E, migrations, OTel, SSE, audit ; app RLS = preuve de session non archivée | `artifacts/phase5/e2e-2026-10-25T22-08-32-680Z/` |
| CI distante réellement exécutée | BLOCKED-EXTERNAL | aucun remote Git | accès dépôt/runner |
| Remote Git | BLOCKED-EXTERNAL | `git remote -v` vide | URL + credentials |
| Staging PostgreSQL dédié | PASS (preuve de session non archivée) | conteneur `gymsoins-postgres-staging` sain, port 55433, 29 migrations, 31 tables, 45 policies, rôles conformes | `docker ps`, SQL |
| API/workers staging local | PASS (runtime isolé) | API KDS actif, workers KDS désactivé, rétention purge OK, aucun `kds_poll_errors_total` | `artifacts/phase5/workers-2026-10-25T22-08-34-107Z/` |
| Prometheus local | PASS | historique 2.55.1 port 9091 ; runtime isolé port 9092, 3 cibles UP | `artifacts/phase5/prometheus-2026-10-25T22-08-34-475Z/` |
| Grafana local | PASS (snapshot read-only archivé) | 11.3.0, port 3001, datasource OK, dashboard 9 panneaux | `artifacts/phase5/observability-readonly-2026-10-25T22-28-42-179Z/` |
| Alerte déclenchée | PASS (snapshot read-only archivé) | `GymSoinsStagingAlertPipelineTest` firing au snapshot | même archive |
| Alerte résolue | PASS (preuve de session non archivée) | règle neutralisée → inactive, puis re-fire ; non rejoué dans la passe corrections | `/api/v1/alerts` |
| Alertes scrape workers | PASS runtime | 24 alertes ; Outbox et Retention testées `firing` puis `inactive` après reprise | `artifacts/phase5/prometheus-2026-10-25T22-08-34-475Z/` |
| Erreurs KDS rétention | PASS après correction sur runtime isolé ; ancienne pile encore `firing` | `GymSoinsKdsPollErrors` firing sur la pile historique au snapshot ; runtime isolé final `inactive`, aucun `kds_poll_errors_total` | `artifacts/phase5/workers-2026-10-25T22-08-34-107Z/` + `observability-readonly-2026-10-25T22-28-42-179Z/` |
| Observabilité staging externe | BLOCKED-EXTERNAL | Prometheus/Grafana locaux validés, pas d’exposition staging externe | staging |
| Résilience API multi-hôte | NOT-TESTED / BLOCKED-EXTERNAL | workers multi-processus = preuve de session non archivée ; API multi-hôte non exécutée | staging/LB |

## 10. Décisions produit ouvertes

| Sujet | Statut | Décision actuelle |
|---|---|---|
| `settings` global vs tenant | DECISION-OPEN | branding global conservé |
| Email unique plateforme vs par tenant | DECISION-OPEN | email global unique conservé |
| Archivage Outbox | DEFERRED | purge PROCESSED uniquement |
| Refresh tokens | DEFERRED | access token uniquement |
| Branding par établissement | NOT-IMPLEMENTED | aucun changement silencieux |

## 11. Risques résiduels

1. Le rôle propriétaire/migration `gymsoins` est superuser et contourne RLS ; il ne doit jamais être utilisé par l'API. En production, le rôle de migration doit rester séparé et protégé.
2. Les fonctions `SECURITY DEFINER` (`list_kds_outbox_events`, `consume_kds_stream_ticket`, `outbox_stats_global`, purge) sont des surfaces privilégiées. Elles sont limitées et accordées aux rôles runtime concernés.
3. Les tables globales (users, tenants, memberships, settings, audit) sont accessibles au runtime selon grants ; elles ne sont pas tenant-owned.
4. Le rôle app peut lire les événements KDS multi-tenant via la fonction contrôlée pour router SSE ; une faille d'injection SQL dans ce chemin exposerait ces événements.
5. La suite E2E fonctionnelle utilise le rôle propriétaire ; la suite RLS et les smokes app/worker utilisent les rôles runtime. Les deux sont exécutées.
6. La réutilisation du pool est testée ; la résilience multi-instance réelle ne l'est pas.
7. L'UI browser est testée localement, pas en CI.
8. CI/staging/dashboards/alertes ne sont pas exécutés sur infrastructure réelle.
9. Les preuves E2E/UI/SSE/OTel/charge/backup/KDS/Prometheus sont archivées et leurs manifestes SHA-256 vérifiés ; les garde-fous refusent `55432` par défaut et `gymsoins_staging` sans exception. `55432` exige `ALLOW_LEGACY_TEST_DB=true` **et** une base de l'allowlist exacte (`gymsoins_test`, `gymsoins_ci`, `gymsoins_backup_source`, `gymsoins_migration_blank`, `gymsoins_restore_check`) ; `gymsoins_test` reste legacy et n'est pas utilisé par la CI.
10. La correction KDS est validée en runtime isolé (API active, workers désactivés, aucun `kds_poll_errors_total` sur la rétention).
11. Restore/verify restore restent non rejoués faute de seconde base cible autorisée.
12. Les alertes `GymSoinsOutboxFailed` (fixtures E2E) et `GymSoinsBackupMetricsMissing` restent visibles sur la pile de test ; elles ne sont pas causées par les nouvelles règles de scrape workers.
13. Le smoke `verify:app-rls`, la résilience workers multi-processus et la résolution/re-déclenchement de l'alerte de test Prometheus restent des preuves de session non archivées ; ils n'ont pas été rejoués dans la passe de corrections.

## 12. Décision finale

# `CORRECTIONS APPLIQUÉES — PRÊT POUR REVUE FINALE`

Les corrections ciblées sont implémentées et validées : garde-fous de cible dans les scripts opérationnels, allowlist CI, `test:unit` en CI, KDS API/workers, archivage des preuves et alertes de scrape. La revalidation runtime isolée du 2026-10-25 est PASS, avec preuves archivées et vérifiées.

La phase globale reste toutefois dépendante de contrôles externes non exécutés : CI distante, remote Git, staging applicatif externe, Alertmanager externe, résilience API multi-hôte et restore sur cible distincte. Ces points sont `BLOCKED-EXTERNAL` ou `NOT RUN`, pas des échecs des corrections ciblées.
