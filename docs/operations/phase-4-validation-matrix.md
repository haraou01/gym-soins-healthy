# Phase 4 — matrice de validation

Date : 2026-10-25  
Statuts : PASS / FAIL / BLOCKED-EXTERNAL / BLOCKED-TECHNICAL / NOT-TESTED /
NOT-APPLICABLE.

## 1. Modèle et migrations

| Critère | Statut | Preuve / commande | Risque résiduel / action |
|---|---|---|---|
| Modèle tenants + memberships | PASS | `024_multi_tenant.sql`, `025_tenant_composite_fks.sql`, `026_fix_loyalty_tenant_unique.sql` | Email global unique, RLS absent |
| Migration base vierge | PASS | 26/26 migrations, 31 tables | — |
| Second passage | PASS | 0 migration appliquée / 26 déjà à jour | — |
| Migration de données historiques | PASS | base `gymsoins_test` 23 migrations → 26 ; comptages conservés | mapping legacy documenté |
| Backfill tenant legacy | PASS | 1 user, 2 products, 22 sales, 25 bookings, 1225 kitchen orders, 70 outbox, 2460 idempotency, 8 tickets migrés vers `00000000-0000-0000-0000-000000000001` | données historiques restent dans legacy |
| Aucune valeur `tenantId` NULL | PASS | contrôle SQL sur produits, ventes, bookings, commandes, Outbox, idempotency | — |
| Contraintes unicité tenant | PASS | SKU, ingrédient, série, loyalty, idempotency, dish_ingredients | — |
| Exclusions Booking tenant | PASS | contraintes recréées avec `tenantId` | — |
| FK composites enfant/parent | PASS | `025_tenant_composite_fks.sql` appliquée et validée sur données existantes | — |
| Table 026 correctif contrainte casse | PASS | `loyalty_accounts_clientId_key` supprimée, index tenant créé | — |

## 2. Isolation applicative

| Critère | Statut | Preuve / test | Risque résiduel |
|---|---|---|---|
| Isolation Shop (lecture, liste, update, delete) | PASS | E2E A/B : 404 sur ID A avec token B | — |
| Isolation Shop vente cross-tenant | PASS | produit A + token B → 404 | — |
| Unicité SKU par tenant | PASS | même SKU créé A et B → 201 | — |
| Isolation Booking | PASS | ID/cancel A avec B → 404 | — |
| Exclusions Booking cross-tenant | PASS | même ressource/créneau A+B → 2×201 | — |
| Isolation Care | PASS | service/pack A avec B → 404 | — |
| Isolation Healthy Food | PASS | ingrédient/plat/commande/statut A avec B → 404 | — |
| Isolation Maintenance | PASS | équipement/ticket A avec B → 404 | — |
| Unicité série équipement par tenant | PASS | même série A+B → 201 | — |
| Isolation Gym | PASS | abonnement A avec B → 404 | — |
| Isolation Loyalty | PASS | même `clientId` A/B → comptes séparés | — |
| Isolation Outbox stats/failed/retry | PASS | consultations filtrées par tenant | worker global attendu |
| Idempotence inter-tenant | PASS | même clé A et B → deux ventes distinctes | — |
| Plusieurs adhésions | PASS | `409 TENANT_SELECTION_REQUIRED`, login avec `tenantId`, switch tenant | — |
| Tenant non autorisé | PASS | switch vers tenant absent → 403 | — |
| Rôle insuffisant dans le bon tenant | PASS | tests RBAC existants + rôle d'adhésion | — |
| Service sans contexte tenant | PASS | `BookingService.findAllBookings()` → `Contexte tenant absent` | — |
| Ticket SSE lié au tenant | PASS | tickets A/B consommés avec leurs tenantIds | — |
| Flux SSE A/B | PASS | `npm run verify:kds-sse` : A reçoit A, B ne reçoit pas A, B reçoit B, A ne reçoit pas B | preuve HTTP réelle locale |
| Reconnexion SSE | PASS | ticket A/B et `resync` ; script Phase 3 | — |
| Fallback polling | PASS (code) / NOT-TESTED (navigateur) | pages chargées et API tenant-scoped | test navigateur absent |
| Frontend login multi-tenant | PASS (typecheck/build) / NOT-TESTED (E2E navigateur) | `Login.tsx`, `useAuth.tsx` | test UI non exécuté |
| Switch tenant frontend | PASS (build) / NOT-TESTED (E2E navigateur) | Sidebar + `switch-tenant` | test UI non exécuté |

## 3. Outbox, workers, rétention

| Critère | Statut | Preuve | Risque résiduel |
|---|---|---|---|
| Outbox porte le tenant | PASS | colonne `tenantId`, append contexte, tests | — |
| Worker reconstruit le contexte tenant | PASS | `runWithTenantContext(event.tenantId)` ; OTel/outbox corrélés | — |
| Listener Loyalty tenant-scoped | PASS | crédit A/B séparé, idempotence | — |
| Stats/failed/retry API tenant-scoped | PASS | E2E stats A/B | worker garde vue globale |
| Rétention globale | PASS | purge idempotency/outbox, tests Phase 3 | tâche système transverse |
| Double exécution rétention | PASS | verrou advisory, Phase 3 | — |

## 4. Observabilité, OTel, charge

| Critère | Statut | Preuve | Risque |
|---|---|---|---|
| OTel SDK + OTLP | PASS | `npm run verify:otel` : spans HTTP, PG, `outbox.append`, `outbox.process`, trace IDs corrélés | collecteur local uniquement |
| Logs tenant | PASS | `tenantId` ajouté aux logs HTTP | — |
| Métriques sans label tenant haute cardinalité | PASS | métriques agrégées, pas de label tenant | — |
| Dashboard/alertes définis | PASS | `npm run validate:ops` : 22 alertes, 9 panneaux | non déployés |
| Alertes déclenchées | NOT-TESTED | aucun Prometheus/Grafana staging | BLOCKED-EXTERNAL |
| Charge mono-tenant après isolation | PASS | matrice 100/500, p50/p95/p99 dans `docs/load-tests.md` | machine locale |
| Charge multi-tenant A+B | NOT-TESTED | non exécutée | à planifier |
| Résilience multi-instance | NOT-TESTED | non exécutée | staging requis |

## 5. Sécurité / dépendances / secrets

| Critère | Statut | Preuve | Risque |
|---|---|---|---|
| Audit secrets | PASS | `npm run audit:secrets` 0 finding | — |
| npm audit high/critical production | PASS | `npm audit --omit=dev --audit-level=high` exit 0 | — |
| npm audit moderate production | PASS partiel | 6 moderate, Nest 12 majeur différé, `file-type` non exposé | migration Nest à planifier |
| npm audit dev | PASS partiel | 4 high dev (CLI) non runtime | upgrade CLI à planifier |
| JWT sans tenant rejeté | PASS | `JwtStrategy` exige `tenantId`/`membershipId` | tokens existants invalidés |
| Révocation adhésion immédiate | PASS | relecture membership/tenant par requête | coût DB par requête |
| Hash de mot de passe non exposé | PASS | `/tenant/members` mappe des champs sûrs | — |

## 6. CI / staging / RLS

| Critère | Statut | Preuve | Blocage |
|---|---|---|---|
| CI workflow défini | PASS | `.github/workflows/ci.yml` valide YAML | — |
| CI locale équivalente | PASS | build, E2E, migrations, OTel, SSE, rétention | — |
| CI distante exécutée | BLOCKED-EXTERNAL | aucun remote Git | accès dépôt requis |
| Remote Git | BLOCKED-EXTERNAL | `git remote -v` vide | credentials/URL externes |
| Staging déployé | BLOCKED-EXTERNAL | aucune infrastructure | host/secrets staging |
| Smoke staging authentifié | BLOCKED-EXTERNAL | pas de staging | staging requis |
| RLS PostgreSQL | FAIL | non activé | pool/contexte SQL non résolu |
| Accès SQL direct cross-tenant | FAIL | rôle DB applicatif non restreint | RLS/rôle dédié requis |
| Requêtes SQL applicatives hors repository | PASS | audit des `.query` ; Outbox/Idempotency/KDS/retention contrôlés | DB direct hors app non protégée |

## 7. Tests / build / backup

| Critère | Statut | Preuve |
|---|---|---|
| Backend build | PASS | `npm run build` |
| Frontend typecheck/build | PASS | `tsc --noEmit`, `npm run build` |
| E2E | PASS | 55/55 |
| Tests existants conservés | PASS | 47 tests Phase 3 + 8 tests multi-tenant |
| Backup/restore | PASS | 31 tables, 26 migrations, 0 mismatch |
| Smoke données restaurées | PASS | users=7, settings=1, roles=5 |
| KDS SSE HTTP A/B | PASS | `npm run verify:kds-sse` |
| OTel OTLP | PASS | `npm run verify:otel` |

## 8. Critères de clôture Phase 4

| Critère obligatoire | Statut |
|---|---|
| Modèle multi-tenant implémenté/documenté | PASS |
| Données/autorisations/événements/workers/SSE cloisonnés | PASS applicatif |
| Tests négatifs critiques sans fuite applicative | PASS |
| Migrations historiques validées | PASS |
| CI et staging réellement exécutés | BLOCKED-EXTERNAL |
| RLS / accès SQL direct protégé | FAIL |
| Chaque critère avec preuve | PASS partiel |
| Charge multi-tenant | NOT-TESTED |

## 9. Décision

La Phase 4 est **NON TERMINÉE**.

Elle est techniquement avancée et l'isolation applicative est testée, mais les
critères de clôture ne sont pas tous satisfaits :

1. **RLS / accès SQL direct cross-tenant : FAIL.**
2. **CI distante et staging : BLOCKED-EXTERNAL.**
3. **Charge multi-tenant et résilience multi-instance : NOT-TESTED.**

Aucun statut n'est attribué sans preuve.
