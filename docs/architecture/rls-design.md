# RLS PostgreSQL — design Phase 5

## 1. Objectif

Faire de PostgreSQL une seconde barrière d'isolation tenant, indépendante des
services NestJS et des repositories. Le rôle runtime ne doit pouvoir ni lire,
ni écrire les lignes d'un autre tenant, même avec une requête SQL directe.

## 2. Rôles PostgreSQL

| Rôle | Usage | Propriétaire | SUPERUSER | BYPASSRLS |
|---|---|---|---|---|
| `gymsoins` | migration/bootstrap, propriétaire des tables | oui | oui (local/CI) | oui de fait |
| `gymsoins_app` | API HTTP | non | non | non |
| `gymsoins_worker` | worker Outbox | non | non | non |
| `gymsoins_retention` | worker rétention | non | non | non |

Les rôles runtime ont des noms fixes (`gymsoins_app`, `gymsoins_worker`,
`gymsoins_retention`) référencés par les policies. Le bootstrap
`scripts/bootstrap-db-roles.js` active `LOGIN` et fixe le mot de passe depuis
l'environnement. Aucun mot de passe n'est stocké dans Git.

Le propriétaire des tables n'est jamais utilisé par l'API. Les workers ont des
rôles distincts avec des policies minimales.

## 3. Tables globales

Pas de RLS, accès contrôlé par grants et par l'application :

```text
tenants
tenant_memberships
users
roles
permissions
role_permissions
licenses
settings
security_audit_logs
schema_migrations
```

Justifications :

- `tenants` / `tenant_memberships` : résolution d'identité avant contexte ;
- `users` : authentification email globale ;
- `roles` / `permissions` : référentiel ;
- `licenses` / `settings` : configuration de déploiement ;
- `security_audit_logs` : audit global auth, tenant nullable ;
- `schema_migrations` : migration uniquement, non grantée au runtime.

## 4. Tables tenant-owned et policies

```text
access_logs
bookings
care_services
care_sessions
client_care_packages
dish_ingredients
dishes
equipments
group_classes
ingredients
kitchen_orders
loyalty_accounts
loyalty_transactions
maintenance_tickets
products
sale_items
sales
subscriptions
idempotency_keys
outbox_events
kds_stream_tickets
```

Policies :

```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <table> FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_app ON <table>
  FOR ALL TO gymsoins_app
  USING ("tenantId" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = nullif(current_setting('app.tenant_id', true), '')::uuid);
```

- Un contexte absent ou vide retourne `NULL` => aucune ligne, aucune écriture.
- Un UUID invalide provoque une erreur SQL, jamais un accès global.
- `FORCE ROW LEVEL SECURITY` est activé. Le propriétaire superuser/migration
  contourne RLS, ce qui est nécessaire aux migrations et au bootstrap.
- Le rôle runtime ne peut pas `ALTER TABLE`, `SET ROLE`, ni désactiver RLS.

### Worker Outbox

Le worker doit sélectionner des événements de plusieurs tenants. Il possède :

- policy `tenant_isolation_worker` sur les tables métier avec le même GUC ;
- policy `outbox_worker_all` sur `outbox_events` permettant le claim global ;
- policy `idempotency_worker_tenant` sur `idempotency_keys`.

Après le claim, le worker exécute les listeners métier dans une transaction
avec `SET LOCAL app.tenant_id = event.tenantId`.

### Worker rétention

`gymsoins_retention` a des policies globales uniquement sur :

- `outbox_events` ;
- `idempotency_keys`.

Il n'a aucun grant sur les tables métier.

### API KDS SSE

L'API doit lire des événements Outbox KDS de plusieurs tenants pour les router
vers les bons abonnés. Deux fonctions `SECURITY DEFINER` contrôlées :

```text
consume_kds_stream_ticket(token_hash)
list_kds_outbox_events(cursor, limit)
outbox_stats_global()
```

Elles sont détenues par le rôle propriétaire, avec `search_path=public`, et
exécutables uniquement par `gymsoins_app` (et le worker pour la lecture KDS).
Elles ne retournent que les colonnes nécessaires.

## 5. Contexte tenant SQL

Le contexte applicatif AsyncLocalStorage n'est pas visible par PostgreSQL. Un
pont explicite est ajouté dans le driver `pg`.

### Requête hors transaction

Pour une requête tenant-scoped hors transaction, le driver exécute sur la même
connexion :

```sql
BEGIN;
SELECT set_config('app.tenant_id', $1, true);
<query>;
COMMIT;
```

En cas d'erreur : `ROLLBACK`.

### Requête dans une transaction

Au `BEGIN`, le driver mémorise l'état de transaction. Avant la première requête
de la transaction, il exécute `set_config(..., true)`. Le `SET LOCAL` est
automatiquement annulé au COMMIT/ROLLBACK.

### Contexte absent

Aucun GUC n'est positionné. Les policies RLS retournent zéro ligne et refusent
les INSERT tenant-owned.

### Pool / réutilisation

- `SET LOCAL` est transactionnel, jamais session-global.
- Les tests couvrent commit, rollback, erreur SQL, réutilisation A→B.
- Le driver sérialise les opérations par client pour éviter les mélanges.

## 6. Limites

- Le rôle `gymsoins` doit rester propriétaire/superuser ou BYPASSRLS pour les
  migrations. Le runtime ne l'utilise jamais.
- Les tables globales restent accessibles au runtime selon les grants ; elles
  ne contiennent pas de données métier tenant-owned.
- Email global unique et settings global restent des décisions produit.
- Les fonctions `SECURITY DEFINER` sont une surface d'administration contrôlée
  et auditée.

## 7. Tests obligatoires

- SELECT direct A/B avec `gymsoins_app` ;
- INSERT/UPDATE/DELETE cross-tenant ;
- changement de `tenantId` ;
- contexte absent/vide/invalide ;
- rollback, erreur, réutilisation de connexion ;
- concurrence pool A/B ;
- relations parent/enfant ;
- Outbox : app tenant, worker global contrôlé, rétention ;
- tables globales autorisées ;
- impossibilité pour le runtime de désactiver RLS ;
- `relforcerowsecurity = true`.

Les tests utilisent PostgreSQL réel, pas de mock.

## 8. Implémentation effective

### Migrations

- `027_rls_roles_policies.sql` : rôles, grants, 45 policies, FORCE RLS,
  fonctions tickets/SSE/stats.
- `028_retention_rls_functions.sql` : purges rétention contrôlées.
- `029_worker_metrics_function_grant.sql` : métriques Outbox globales pour workers.

### Rôles

```text
gymsoins_app        API HTTP
gymsoins_worker     worker Outbox
gymsoins_retention  worker rétention
```

`scripts/bootstrap-db-roles.js` active LOGIN + mots de passe depuis
`APP_DB_PASSWORD`, `WORKER_DB_PASSWORD`, `RETENTION_DB_PASSWORD`.

### Pont SQL

`src/core/database/rls-query-guard.ts` est importé par `AppModule` dans tous
les processus. Il :

- lit le tenant depuis AsyncLocalStorage ;
- utilise `set_config('app.tenant_id', ..., true)` dans la transaction ;
- enveloppe une requête hors transaction dans `BEGIN / SET LOCAL / query / COMMIT` ;
- rollback sur erreur ;
- sérialise les opérations par connexion pool.

### Fonctions SECURITY DEFINER

```text
consume_kds_stream_ticket(token_hash)
list_kds_outbox_events(cursor, limit)
outbox_stats_global()
purge_idempotency_batch(cutoff, limit)
purge_outbox_batch(cutoff, limit)
```

Elles sont limitées aux rôles runtime concernés, avec `search_path=public,pg_temp`.

### Limites

- Le rôle de migration/propriétaire contourne RLS (superuser/BYPASSRLS). Il ne
  doit jamais servir l'API.
- Les tables globales ne sont pas RLS.
- La fonction `list_kds_outbox_events` est une lecture cross-tenant contrôlée
  nécessaire au routage SSE.
- La fonction `outbox_stats_global` expose uniquement des agrégats.
- Une faille d'injection SQL dans l'API pourrait appeler ces fonctions ; leur
  surface est volontairement minimale.

### Preuves

- `test/rls.e2e-spec.ts` : 15 tests avec `gymsoins_app`.
- `npm run verify:app-rls` : smoke HTTP de tous les modules sous RLS.
- `npm run verify:kds-sse` : SSE A/B, tickets, reconnexion.
- `package.json` : `playwright-core` et `verify:ui` pour le navigateur réel.
