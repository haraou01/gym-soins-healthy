# Design multi-tenant strict — Phase 4

## 1. Décision d'architecture

Le modular monolith est conservé. Le tenant est une propriété de sécurité
dérivée côté serveur d'une identité authentifiée et d'une adhésion active.

```text
Tenant
  └── TenantMembership (user + role + statut)
        └── JWT { tenantId, membershipId, role }
              └── TenantContext (AsyncLocalStorage)
                    └── services tenant-scoped
                          ├── PostgreSQL (tenantId + contraintes)
                          ├── Idempotency (tenantId, scope, key)
                          ├── Outbox (tenantId)
                          └── SSE ticket (tenantId)
```

Aucun `tenantId` fourni librement par body/query/header n'est utilisé pour
choisir le tenant d'une opération métier.

## 2. Modèle relationnel cible

### `tenants`

```text
id UUID PK
slug VARCHAR(80) UNIQUE
name VARCHAR(150)
status tenant_status_enum (ACTIVE, SUSPENDED)
createdAt, updatedAt
```

### `tenant_memberships`

```text
id UUID PK
tenantId UUID FK tenants
userId UUID FK users
roleId UUID FK roles
status tenant_membership_status_enum (ACTIVE, SUSPENDED)
createdAt, updatedAt
UNIQUE(tenantId, userId)
INDEX(userId), INDEX(tenantId)
```

### Référentiels globaux

- `users` : identité globale, email unique plateforme.
- `roles`, `permissions`, `role_permissions` : catalogue RBAC global.
- `licenses` : licence d'installation.
- `settings` : configuration de déploiement/branding global.
- `security_audit_logs` : audit global auth, `tenantId` nullable.
- `schema_migrations`.

### Tables tenant-owned

Toutes les tables métier + :

- `idempotency_keys` ;
- `outbox_events` ;
- `kds_stream_tickets`.

Toutes possèdent :

```text
tenantId UUID NOT NULL FK tenants(id)
```

Les tables enfants ont également des FK composites
`(tenantId, parentId) -> parent(tenantId, id)` pour les relations concernées
(`sale_items`, `dish_ingredients`, `care_sessions`, `client_care_packages`,
`maintenance_tickets`, `loyalty_transactions`).

## 3. Authentification et contexte

### Premier administrateur

`POST /api/v1/auth/register` crée :

1. un tenant ;
2. un utilisateur ;
3. une adhésion `SUPER_ADMIN` dans ce tenant.

Le rôle demandé dans l'ancien champ `role` est ignoré : un self-service signup
ne peut pas créer un rôle arbitraire.

### Login

`POST /api/v1/auth/login` accepte `tenantId` optionnel.

- zéro adhésion active → `401` ;
- une adhésion → sélection automatique ;
- plusieurs adhésions sans `tenantId` → `409 TENANT_SELECTION_REQUIRED` avec la
  liste des tenants autorisés ;
- `tenantId` demandé non membre → `403`.

Le JWT contient :

```json
{
  "sub": "user-uuid",
  "email": "user@example.com",
  "role": "CHEF",
  "tenantId": "tenant-uuid",
  "membershipId": "membership-uuid"
}
```

### Validation par requête

`JwtStrategy.validate()` recharge l'adhésion active et le tenant actif. Une
adhésion révoquée ou un tenant suspendu invalide immédiatement le token, sans
attendre son expiration.

### Changement de contexte

- `GET /api/v1/auth/tenants` : adhésions actives de l'utilisateur.
- `POST /api/v1/auth/switch-tenant` : vérifie l'adhésion cible puis émet un
  nouveau JWT avec le rôle du tenant cible.

### Contexte d'exécution

`TenantContextInterceptor` place `{tenantId,userId,role,membershipId}` dans un
`AsyncLocalStorage`. Les services appellent `requireTenantId()` et ne peuvent
pas accéder aux repositories tenant-owned sans contexte.

## 4. Autorisations

- `SUPER_ADMIN`, `RECEPTIONIST`, `COACH`, `THERAPIST`, `CHEF` restent le
  catalogue de rôles.
- Le rôle effectif vient de `tenant_memberships.roleId`, jamais de
  `users.role_id` pour les décisions runtime.
- `RolesGuard` et `PermissionsGuard` utilisent le rôle du JWT validé par
  `JwtStrategy`.
- Un rôle `CHEF` du tenant A n'a aucun droit dans le tenant B.

## 5. Règles de scoping

Pour chaque ressource tenant-owned :

- lecture par ID : `WHERE id = $id AND tenantId = $tenant`;
- listes/recherches/agrégations : `WHERE tenantId = $tenant`;
- updates/deletes : filtre tenant obligatoire ;
- création : `tenantId` serveur injecté ;
- les IDs d'objets fournis par le client ne suffisent jamais ;
- les ressources d'un autre tenant retournent `404` (pas de fuite d'existence).

Les services concernés : Booking, Care, Gym, Healthy Food, Loyalty,
Maintenance, Shop, Outbox, KDS, Idempotency.

## 6. Outbox et workers

- `outbox_events.tenantId` est `NOT NULL`.
- `OutboxService.append()` exige le contexte tenant et l'écrit.
- Le worker traite globalement mais reconstruit un `TenantContext` à partir de
  `event.tenantId` avant d'émettre l'événement.
- L'événement émis contient `tenantId` et `outboxEventId`.
- Les listeners (Loyalty) s'exécutent donc dans le bon tenant.
- Les stats/failed/retry exposés via l'API sont filtrés par le tenant courant ;
  le worker conserve une vue globale nécessaire au dispatch.

## 7. Idempotence

- Colonne `tenantId`.
- Unicité `(tenantId, scope, key)`.
- `INSERT ... ON CONFLICT` et lecture filtrées par tenant.
- Une même clé dans A et B crée deux opérations indépendantes.

## 8. KDS SSE

- Ticket opaque, hashé SHA-256, TTL 60 s, usage unique.
- `tenantId` UUID réel dans le ticket, dérivé du JWT/adhesion.
- Ticket A ne peut pas ouvrir un flux B : le flux utilise le tenant du ticket.
- Les événements Outbox portent le tenant.
- `KdsEventsService` filtre chaque abonnement par `tenantId`.
- Le fallback REST est tenant-scoped par les services.
- Reconnexion : nouveau ticket, `resync`, état REST.

## 9. Migration et backfill

Migrations :

- `024_multi_tenant.sql` : tenants, memberships, tenantId, backfill legacy,
  NOT NULL, FK, index, unicités tenant, exclusions Booking.
- `025_tenant_composite_fks.sql` : FK composites parent/enfant.
- `026_fix_loyalty_tenant_unique.sql` : suppression de l'ancienne contrainte
  `loyalty_accounts_clientId_key` (casse PostgreSQL) et unicité tenant.

Tenant legacy déterministe :

```text
00000000-0000-0000-0000-000000000001
slug: legacy
```

Toutes les données historiques sont assignées au tenant legacy. Les anciennes
structures et colonnes sont conservées. Le mapping est contrôlé par comptage
avant/après.

## 10. RLS PostgreSQL — Phase 5

RLS est activé sur les 21 tables tenant-owned avec `FORCE ROW LEVEL SECURITY`.

Le pont SQL est explicite :

- `src/core/database/rls-query-guard.ts` lit le tenant depuis
  AsyncLocalStorage ;
- `set_config('app.tenant_id', ..., true)` est exécuté dans la transaction ;
- une requête hors transaction est enveloppée dans
  `BEGIN / SET LOCAL / query / COMMIT` sur la même connexion ;
- aucun `SET` de session n'est utilisé ;
- le runtime utilise `gymsoins_app`, le worker `gymsoins_worker`, la rétention
  `gymsoins_retention`, tous non superuser/non BYPASSRLS.

Les accès SQL directs du rôle runtime aux lignes d'un autre tenant sont
refusés. Le rôle propriétaire/migration contourne RLS pour les migrations, mais
n'est jamais utilisé par l'API.

Détails : `docs/architecture/rls-design.md`.

## 11. Frontend

- Login sans sélection de rôle (le rôle est serveur).
- En cas de `TENANT_SELECTION_REQUIRED`, sélection d'établissement.
- Le JWT stocke le tenant courant.
- `useAuth` recharge `/auth/tenants` et expose un sélecteur de tenant dans la
  sidebar pour les utilisateurs multi-adhésions.
- `POST /auth/switch-tenant` remplace le token.

## 12. Décisions restant à trancher

- Email global unique ou identité multi-tenant par email.
- Branding/settings global ou par tenant.
- RLS et rôle SQL applicatif dédié.
- Politique de conservation/archivage Outbox.
- SLO multi-tenant et tests de charge multi-instance.
- Accès staging/remote Git.
