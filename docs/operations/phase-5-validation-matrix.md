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
| Worker rétention réel | PASS | `/health`, métriques, purge via fonctions | `start:retention` + health |
| Purge rétention API sous RLS | PASS | `idempotencyKeysPurged=1`, `outboxEventsPurged=1` | endpoint retention |
| Liste Outbox KDS multi-tenant | PASS | fonction `list_kds_outbox_events` | test RLS + SSE |
| Ticket SSE sans contexte préalable | PASS | fonction `consume_kds_stream_ticket` | test RLS + SSE |
| Worker `/metrics` sous rôle worker | PASS | `outbox_worker_up 1`, `outbox_events` agrégés | worker role + `outbox_stats_global` |
| Retention `/metrics` sous rôle retention | PASS | `retention_worker_up 1`, `outbox_events` agrégés | retention role |
| API `/internal/metrics` sous rôle app | PASS | `outbox_stats_global` accessible, pas de lecture directe globale | app role |

## 4. Validation applicative complémentaire

| Critère | Statut | Preuve | Commande |
|---|---|---|---|
| E2E fonctionnels existants | PASS | 55/55, app rôle propriétaire | `npx jest ...` |
| E2E RLS PostgreSQL réel | PASS | 15/15, rôle `gymsoins_app` | `test/rls.e2e-spec.ts` |
| Total E2E | PASS | 70/70 | `TEST_PG_DATABASE=... npx jest` |
| App role — tous modules HTTP | PASS | Gym, Care, Booking, Maintenance, Shop, Loyalty, Healthy Food, Outbox | `npm run verify:app-rls` |
| Inscription premier admin navigateur | PASS | tenant créé + dashboard | `npm run verify:ui` |
| Login une adhésion | PASS | dashboard | `verify:ui` |
| Login multi-adhésions | PASS | sélecteur `TENANT_SELECTION_REQUIRED` | `verify:ui` |
| Switch tenant | PASS | token remplacé, reload | `verify:ui` |
| Isolation données UI | PASS | produit A absent après switch B | `verify:ui` |
| Adhésion révoquée | PASS | 401 + retour login | `verify:ui` |
| Navigateur réel | PASS local | Chrome + `playwright-core` | `npm run verify:ui` |
| UI en CI | NOT-TESTED | Chrome/Vite absents du workflow | à planifier |

## 5. SSE

| Critère | Statut | Preuve | Commande |
|---|---|---|---|
| SSE A/B initial | PASS | A reçoit A, B ne reçoit pas A | `npm run verify:kds-sse` |
| Ticket réutilisé | PASS | HTTP 401 | `verify:kds-sse` |
| Ticket expiré | PASS | HTTP 401 | `verify:kds-sse` |
| Reconnexion nouveau ticket | PASS | `resync` + nouveaux events | `verify:kds-sse` |
| Absence de fuite après reconnexion | PASS | A ne reçoit pas B et inversement | `verify:kds-sse` |
| Fallback REST | PASS | listes A/B isolées | `verify:kds-sse` |
| Fallback navigateur | PASS | SSE bloqué, UI affiche le fallback polling et reste utilisable | `npm run verify:ui` |

## 6. Charge multi-tenant

| Critère | Statut | Preuve | Commande |
|---|---|---|---|
| Charge A/B concurrente | PASS | 8 scénarios, 2 tenants, 100 req/tenant, concurrence 25 | `LOAD_MULTI_REQUESTS=100 LOAD_MULTI_CONCURRENCY=25 npm run load:test:multi` |
| Booking A/B | PASS | 100×201/tenant, p95 152-178 ms | même exécution |
| Shop A/B | PASS | 100×201/tenant, p95 708-955 ms | même exécution |
| KDS A/B | PASS | 100×201/tenant + 100×200 statuts | même exécution |
| Outbox | PASS | 600 PROCESSED, 0 mismatch | même exécution |
| Invariant données | PASS | 0 ligne cross-tenant détectée | même exécution |
| Résilience multi-instance | NOT-TESTED | une seule instance locale | staging requis |

Détail p50/p95/p99 : `docs/load-tests.md`.

## 7. Migrations, backup, OTel

| Critère | Statut | Preuve | Commande |
|---|---|---|---|
| Migrations base vierge | PASS | 29/29, 31 tables | `npm run db:migrate` |
| Second passage | PASS | 0/29 | `npm run db:migrate` |
| RLS policies sur base vierge | PASS | 21 tables FORCE, 45 policies | SQL `pg_class`/`pg_policies` |
| Migration historique | PASS | données Phase 4 backfillées, aucun NULL | comptages SQL |
| Backup/restore | PASS | 31 tables, 29 migrations, 0 mismatch | `backup`, `restore`, `verify:restore` |
| OTel SDK/OTLP | PASS | HTTP + PG + outbox.append + outbox.process corrélés | `npm run verify:otel` |
| OTel avec rôles app/worker | PASS | app `gymsoins_app`, worker `gymsoins_worker` | `verify:otel` |

## 8. Sécurité / dépendances / secrets

| Critère | Statut | Preuve | Commande |
|---|---|---|---|
| Audit secrets | PASS | 280 fichiers, 0 finding | `npm run audit:secrets` |
| npm production high/critical | PASS | 0 high, 0 critical | `npm audit --omit=dev --audit-level=high` |
| npm production moderate | PASS partiel | 6 moderate, Nest 12 différé | `npm audit` |
| npm global | PASS partiel | 19 total, 4 high dev | `npm audit` |
| Mot de passe runtime dans Git | PASS | secrets uniquement via env/bootstrap | audit |
| Password hash API | PASS | `/tenant/members` mappe des champs sûrs | E2E |

## 9. CI / staging / observabilité déployée

| Critère | Statut | Preuve | Dépendance |
|---|---|---|---|
| CI workflow défini | PASS | YAML valide | — |
| CI locale équivalente | PASS | build, 70 E2E, migrations, OTel, SSE, app RLS, audit | — |
| CI distante réellement exécutée | BLOCKED-EXTERNAL | aucun remote Git | accès dépôt/runner |
| Remote Git | BLOCKED-EXTERNAL | `git remote -v` vide | URL + credentials |
| Staging | BLOCKED-EXTERNAL | aucune infrastructure | host/secrets |
| Smoke staging | BLOCKED-EXTERNAL | staging absent | staging |
| Observabilité déployée | BLOCKED-EXTERNAL | pas de Prometheus/Grafana déployés | infra |
| Alerte déclenchée | NOT-TESTED / BLOCKED-EXTERNAL | définitions seulement | staging |

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

## 12. Décision finale

# `PHASE 5 NON TERMINÉE — BLOCAGE EXTERNE`

Les critères techniques locaux RLS, pool, workers, UI, SSE, charge A/B, OTel et backup sont validés avec preuves.

La phase ne peut pas être déclarée totalement terminée car :

- CI distante non exécutée ;
- remote Git absent ;
- staging absent ;
- dashboards/alertes non déployés ;
- alerte non déclenchée ;
- résilience multi-instance non exécutée.

Aucun de ces contrôles n'est marqué PASS sans exécution réelle.
