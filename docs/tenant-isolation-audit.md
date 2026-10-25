# Audit isolation tenant — KDS SSE

## Conclusion

**Isolation cross-tenant : NOT TESTABLE / FAIL.**

Le code actuel ne possède pas de modèle tenant réel. Il serait malhonnête de
fabriquer un test multi-tenant en réutilisant `tenantId = 'default'`.

## Constat

| Élément | État actuel |
|---|---|
| Table `tenants` | absente |
| `users.tenantId` | absent |
| `tenantId` dans le JWT | absent |
| `tenantId` dans les commandes KDS | absent |
| `tenantId` dans les ingrédients/plats | absent |
| Filtrage des requêtes KDS par tenant | absent |
| Filtrage des événements Outbox par tenant | absent |
| Tenant du ticket SSE | `default`, dérivé côté serveur |
| Tenant des événements SSE | `default` |
| Rôles KDS | `SUPER_ADMIN`, `CHEF` |
| Données accessibles CHEF | toutes les données `healthy_food` |
| Données accessibles SUPER_ADMIN | tous les modules |

## Chaîne auditée

### Détermination du tenant

Aucune. `JwtStrategy.validate()` retourne `{ id, email, role }`. Il n’y a ni
`tenantId` ni `establishmentId` dans le token.

### Création du ticket

`POST /api/v1/healthy-food/kds/stream-ticket` utilise
`request.user.tenantId ?? 'default'`. Le body et la query sont ignorés : un
client ne peut donc pas choisir un tenant via la requête.

### Consommation du ticket

`KdsStreamTicketService.consume()` valide le hash, l’expiration et effectue une
mise à jour atomique `usedAt` avec `WHERE "usedAt" IS NULL`. Le ticket est à
usage unique.

### Flux SSE

`KdsEventsService.stream(tenantId)` filtre les événements sur
`event.tenantId === tenantId`. Les événements sont actuellement tous `default`.

### Événements Outbox

`kitchen.order.created` et `kitchen.order.status_changed` ne contiennent pas de
`tenantId` métier. `KdsEventsService` applique `payload.tenantId ?? 'default'`.

### Commandes KDS

`HealthyFoodService.findAllOrders()` retourne toutes les commandes sans filtre
tenant. `findOrdersByClient(clientId)` filtre uniquement par `clientId`.

## Preuves de sécurité déjà acquises

- Ticket opaque aléatoire, hash SHA-256 en PostgreSQL.
- TTL 60 secondes.
- Usage unique atomique.
- Rôle `SUPER_ADMIN` ou `CHEF` requis pour créer un ticket.
- Aucun JWT longue durée dans l’URL.
- Le client ne peut pas imposer `tenantId` via query/body (test E2E).
- Ticket expiré/invalide rejeté (test E2E).
- Ticket déjà utilisé rejeté (test E2E).

Ces preuves ne valent pas isolation multi-tenant.

## Ce qui manque pour un vrai multi-tenant

1. Table `tenants` et clé `tenant_id` sur toutes les tables métier.
2. `users.tenant_id` et inclusion du tenant dans le JWT, jamais dans un champ
   client libre.
3. Filtrage systématique des repositories/services par tenant.
4. Isolation PostgreSQL par Row Level Security ou couche de repository
   obligatoire.
5. `tenantId` dans chaque événement Outbox et filtrage SSE.
6. Tests A/B réels : deux tenants, deux utilisateurs, deux tickets, événements
   croisés, rejet de consommation croisée.
7. Audit des accès `SUPER_ADMIN` (accès intentionnel cross-tenant ou non).

## Décision

Le critère **« isolation tenant KDS »** reste **FAIL**.  
La Phase 3 ne peut pas être déclarée terminée sur ce point.
