# Audit architecture multi-tenant — Phase 4

Date : 2026-10-25  
Commit de référence avant modifications : `9d2a41f`  
État Git initial : propre, aucun remote configuré.

## 1. Méthode et commandes disponibles

Commandes réellement disponibles dans `package.json` :

```text
npm run build
npm run test:e2e
npm run db:migrate
npm run db:migrate:baseline
npm run backup
npm run restore
npm run verify:restore
npm run smoke:restore
npm run audit:secrets
npm run load:test
npm run verify:otel
npm run validate:ops
npm run start:worker
npm run start:retention
```

Il n'existe pas de script `lint` ni de suite de tests unitaires séparée dans
`package.json`. Le typecheck backend est porté par `npm run build` ; le
typecheck frontend par `tsc --noEmit`.

## 2. État initial observé

- NestJS modular monolith, PostgreSQL, React/Vite/Tauri.
- 29 tables publiques, 23 migrations avant Phase 4.
- 47 tests E2E verts avant ajout des tests multi-tenant.
- Aucun modèle `tenants`.
- Aucune colonne tenant sur les tables métier.
- Aucun `tenantId` dans le JWT.
- `users.role_id` portait le rôle global.
- `settings` était un singleton global.
- `kds_stream_tickets.tenantId` valait `'default'`.
- `idempotency_keys` était unique sur `(scope, key)` globalement.
- `outbox_events` n'avait aucune dimension tenant.
- Aucun RLS PostgreSQL.
- Aucun remote Git, aucun staging.

## 3. Cartographie des tables

### Données globales / référentiel plateforme

| Table | Classement | Justification |
|---|---|---|
| `tenants` | globale | Racine SaaS, ajoutée Phase 4 |
| `tenant_memberships` | globale de rattachement | Appartenance utilisateur ↔ tenant |
| `users` | identité globale | Email unique plateforme conservé |
| `roles` | référentiel global | Catalogue RBAC |
| `permissions` | référentiel global | Catalogue RBAC |
| `role_permissions` | référentiel global | Jointure RBAC |
| `licenses` | global | Licence d'installation |
| `settings` | global | Branding/configuration de déploiement |
| `schema_migrations` | global | Infrastructure |
| `security_audit_logs` | global auth, tenant nullable | Un échec peut précéder la sélection tenant |

### Données tenant-owned avant Phase 4

`access_logs`, `bookings`, `care_services`, `care_sessions`,
`client_care_packages`, `dish_ingredients`, `dishes`, `equipments`,
`group_classes`, `ingredients`, `kitchen_orders`, `loyalty_accounts`,
`loyalty_transactions`, `maintenance_tickets`, `products`, `sale_items`,
`sales`, `subscriptions`.

Après Phase 4, elles ont toutes `"tenantId" UUID NOT NULL` + FK `tenants`.

### Données de traitement tenant-owned

| Table | Problème initial | Traitement Phase 4 |
|---|---|---|
| `idempotency_keys` | unicité globale `(scope,key)` | `tenantId` + unicité `(tenantId,scope,key)` |
| `outbox_events` | événements non cloisonnés | `tenantId`, index, contexte worker |
| `kds_stream_tickets` | `tenantId='default'` | UUID réel, FK tenant, ticket lié au tenant |

### Données ambiguës / décisions produit

- `settings` reste global : branding de déploiement, pas de configuration
  opérationnelle par établissement.
- `users.email` reste unique globalement : un email ne peut pas appartenir à
  deux identités distinctes. Un utilisateur peut en revanche avoir plusieurs
  adhésions.
- `users.role_id` reste pour compatibilité historique, mais l'autorisation
  runtime utilise désormais `tenant_memberships.roleId`.
- `security_audit_logs` ancien contenu reste avec `tenantId = NULL`.

## 4. Chemins de code sensibles audités

### Authentification / autorisation

- `src/modules/auth/auth.service.ts`
- `src/modules/auth/controllers/auth.controller.ts`
- `src/modules/auth/strategies/jwt.strategy.ts`
- `src/core/security/jwt-auth.guard.ts`
- `src/core/security/roles.guard.ts`
- `src/core/security/permissions.guard.ts`
- `src/modules/auth/auth-audit.service.ts`

Constat initial : JWT `{sub,email,role}`, rôle issu de `users.role_id`, aucun
tenant, aucune vérification d'adhésion par requête.

### Services métier et accès repository

Tous les services ci-dessous ont été audités :

```text
BookingService
CareService
GymService / GymAccessService
HealthyFoodService
LoyaltyService / SaleCompletedListener
MaintenanceService
ShopService
SettingsService
KdsEventsService
KdsStreamTicketService
OutboxService
IdempotencyService
RetentionService
```

Constats initiaux : lectures, listes, recherches, updates et deletes non
tenant-scoped ; un ID valide dans un tenant pouvait être utilisé dans un autre
si l'objet existait et que le rôle le permettait.

### Accès SQL directs

| Fichier | Usage | Risque initial |
|---|---|---|
| `idempotency.service.ts` | INSERT/SELECT clé | clé globale, pas de tenant |
| `outbox.service.ts` | append/claim/dispatch | événement global, pas de tenant |
| `kds-events.service.ts` | poll Outbox | événements tous tenants |
| `retention.service.ts` | purge globale | attendu système, sans tenant |
| `booking.service.ts` | advisory locks | clé sans tenant |
| tests E2E | INSERT directs | colonnes tenant absentes |

Aucun autre `dataSource.query` métier non contrôlé n'a été trouvé.

### Contraintes et index

Constats initiaux :

- `products.sku` unique global.
- `ingredients.name` unique global.
- `equipments.serialNumber` unique global.
- `loyalty_accounts.clientId` unique global.
- `bookings` exclusions sans tenant.
- `dish_ingredients` unique sans tenant.
- `idempotency_keys` unique sans tenant.
- Absence d'index tenant.

### Workers, Outbox, SSE, rétention

- Worker Outbox global, sans contexte tenant.
- Listener Loyalty exécuté sans tenant.
- SSE ticket avec `tenantId='default'`.
- `KdsEventsService` émet tous les événements, filtrage uniquement par
  `payload.tenantId` absent.
- Rétention globale (comportement système attendu).

### Observabilité / CI / staging

- Logs JSON avec `tenantId: null`.
- OTel SDK/OTLP opérationnel Phase 3.
- Prometheus/Grafana définis, non déployés.
- CI GitHub Actions définie, aucun remote.
- Staging absent.

## 5. Risques identifiés avant modifications

1. Fuite de lecture par ID entre établissements.
2. Listes et agrégations cross-tenant.
3. Écrasement/suppression cross-tenant.
4. Collision d'unicité métier entre tenants.
5. Collision d'idempotence entre tenants.
6. Événements Outbox traités hors contexte tenant.
7. SSE cross-tenant.
8. JWT sans adhésion vérifiée.
9. `tenantId='default'` présenté comme isolation.
10. Rôle global `users.role_id` au lieu du rôle d'adhésion.
11. Absence de contraintes relationnelles tenant.
12. Accès SQL direct non protégé par RLS.
13. Branding/settings global.
14. Email global unique (décision produit).
15. Staging/CI distante non exécutés.

## 6. Inconnues / décisions externes

- Infrastructure staging et remote Git : non disponibles.
- Politique produit sur l'email global vs multi-tenant.
- Politique de conservation Outbox : purge PROCESSED uniquement.
- Besoin réel de RLS PostgreSQL et du rôle SQL applicatif dédié.
- Seuils SLO multi-tenant.

## 7. Conclusion d'audit

L'isolation multi-tenant n'était pas démontrable avant Phase 4. Le modèle
applicatif ne permettait pas de fabriquer un test A/B réel : aucun tenant
n'existait.

Le design et l'implémentation Phase 4 sont décrits dans
`docs/architecture/multi-tenant-design.md`. Les preuves et statuts sont dans
`docs/operations/phase-4-validation-matrix.md`.
