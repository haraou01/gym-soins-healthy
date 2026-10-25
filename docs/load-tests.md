# Tests de charge — Phase 3

## Objectif

Mesurer la capacité réelle du modular monolith avant toute optimisation.
Ces résultats ne sont **pas** un benchmark universel.

## Environnement mesuré

| Élément | Valeur |
|---|---|
| Machine | MacBook Apple M1 Pro |
| CPU | 10 cœurs |
| RAM | 16 Go |
| OS | macOS 14.6.1 |
| Node.js | v22.14.0 |
| API | 1 processus `dist/main.js` |
| Frontend | non sollicité |
| PostgreSQL | 16.15, conteneur Docker |
| Port DB | 55432 |
| Base | `gymsoins_test` |
| Pool TypeORM | max 10 connexions |
| Outbox worker | in-process, poll 500 ms |
| Throttle | `THROTTLE_LIMIT=100000` pour le test |
| Durée | matrice exécutée en une passe |
| Nettoyage | `LOAD_CLEANUP=true` |

## Commande

```bash
LOAD_SCENARIO=matrix \
POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=55432 \
POSTGRES_USERNAME=gymsoins POSTGRES_PASSWORD=gymsoins \
POSTGRES_DATABASE=gymsoins_test \
npm run load:test
```

Le smoke test `5 requêtes / concurrence 3` reste disponible via les valeurs
par défaut.

## Résultats — Booking

| Scénario | Requêtes | Concurrence | Throughput | p50 | p95 | p99 | Statuts | Erreurs |
|---|---:|---:|---:|---:|---:|---:|---|---:|
| booking-unique-100@10 | 100 | 10 | 349,65 req/s | 24 ms | 67 ms | 73 ms | 100×201 | 0 |
| booking-conflict-100@10 | 100 | 10 | 221,73 req/s | 45 ms | 48 ms | 50 ms | 1×201, 99×409 | 0 |
| booking-unique-100@25 | 100 | 25 | 427,35 req/s | 54 ms | 64 ms | 68 ms | 100×201 | 0 |
| booking-conflict-100@25 | 100 | 25 | 221,24 req/s | 102 ms | 122 ms | 135 ms | 1×201, 99×409 | 0 |
| booking-unique-100@50 | 100 | 50 | 487,80 req/s | 82 ms | 131 ms | 136 ms | 100×201 | 0 |
| booking-conflict-100@50 | 100 | 50 | 220,26 req/s | 209 ms | 222 ms | 235 ms | 1×201, 99×409 | 0 |
| booking-unique-500@25 | 500 | 25 | 538,79 req/s | 46 ms | 53 ms | 58 ms | 500×201 | 0 |
| booking-conflict-500@25 | 500 | 25 | 253,42 req/s | 97 ms | 110 ms | 120 ms | 1×201, 499×409 | 0 |
| booking-unique-500@50 | 500 | 50 | 536,48 req/s | 92 ms | 100 ms | 111 ms | 500×201 | 0 |
| booking-conflict-500@50 | 500 | 50 | 258,80 req/s | 188 ms | 219 ms | 229 ms | 1×201, 499×409 | 0 |

Les conflits Booking sont volontaires : une même ressource/praticien/créneau.
Les contraintes PostgreSQL d'exclusion restent la protection finale.

## Résultats — Shop

| Scénario | Requêtes | Concurrence | Throughput | p50 | p95 | p99 | Statuts | Erreurs |
|---|---:|---:|---:|---:|---:|---:|---|---:|
| shop-sales-100@25 | 100 | 25 | 76,39 req/s | 286 ms | 509 ms | 528 ms | 100×201 | 0 |
| shop-sales-500@50 | 500 | 50 | 79,55 req/s | 561 ms | 976 ms | 1307 ms | 500×201 | 0 |

Chaque vente utilise une clé d'idempotence distincte. Aucun doublon de vente
n'a été créé. Le stock a été décrémenté une fois par vente.

## Résultats — KDS

| Scénario | Requêtes | Concurrence | Throughput | p50 | p95 | p99 | Statuts | Erreurs |
|---|---:|---:|---:|---:|---:|---:|---|---:|
| kds-orders-100@25 | 100 | 25 | 106,38 req/s | 200 ms | 355 ms | 473 ms | 100×201 | 0 |
| kds-status-100@25 | 100 | 25 | 371,75 req/s | 65 ms | 78 ms | 81 ms | 100×200 | 0 |
| kds-orders-500@50 | 500 | 50 | 116,14 req/s | 370 ms | 807 ms | 1426 ms | 500×201 | 0 |
| kds-status-500@50 | 500 | 50 | 393,08 req/s | 106 ms | 255 ms | 469 ms | 500×200 | 0 |

## Outbox

Après la matrice :

```text
PENDING     : 0
PROCESSING  : 0
PROCESSED   : 1870
FAILED      : 0
db_connections : 10
db_max_connections : 100
db_locks{waiting} : 0
outbox_worker_up : 1
```

Les événements Outbox sont traités pendant la charge. Aucun backlog résiduel.

## SSE / reconnexion

Vérification séparée, avec deux clients simultanés :

```text
2 clients reçoivent resync
kitchen.order.created reçu par les 2 clients
même eventId pour les 2 clients
kitchen.order.status_changed reçu par les 2 clients
même eventId pour les 2 clients
traceId présent
déconnexion volontaire
nouveau ticket
reconnexion
resync reçu
nouvel événement reçu
```

## Limites

- Une seule instance API et une seule instance PostgreSQL.
- Pas de proxy/ingress, pas de TLS, pas de latence réseau ajoutée.
- Résultats dépendants du matériel et de la base locale.
- Les locks PostgreSQL n'ont pas été instrumentés pendant chaque scénario ;
  `db_locks` est disponible dans `/internal/metrics` pour la supervision.
- Aucun test de saturation volontaire DB (`max_connections`) n'a été exécuté.
- Aucun test de résilience worker n'a été exécuté pendant la matrice ; la
  recovery `PROCESSING` est couverte par les E2E.
- Ne pas extrapoler à la production sans test sur l'infrastructure cible.

## Interprétation

Points d'attention avant production :

1. Shop 500@50 : p99 1,3 s, throughput ~80 req/s. Le chemin vente + stock +
   idempotence + Outbox est le plus coûteux.
2. KDS 500@50 : p99 1,43 s à la création, 469 ms sur les changements de statut.
3. Booking tient 500 requêtes, mais les conflits augmentent fortement la
   latence p99 vs les créations uniques.
4. Le pool DB à 10 connexions est un plafond à surveiller (max_connections=100,
   0 lock en attente observé en fin de test).

Aucune optimisation ne doit être engagée sans mesure sur l'infrastructure
cible.

---

## Nouvelle mesure après isolation multi-tenant (2026-10-25)

Les mesures ci-dessous ont été refaites après l'ajout :

- validation d'adhésion par requête (`JwtStrategy`) ;
- filtres `tenantId` dans les services ;
- contraintes et index tenant ;
- événements Outbox/SSE tenant-scoped.

Elles restent **mono-tenant d'exécution** : le script utilise l'administrateur
du tenant legacy. Aucune mesure de charge concurrente A+B n'a été exécutée.

| Scénario | Requêtes | Concurrence | Throughput | p50 | p95 | p99 | Erreurs |
|---|---:|---:|---:|---:|---:|---:|---:|
| booking-unique-100@10 | 100 | 10 | 265,25 req/s | 34 ms | 71 ms | 82 ms | 0 |
| booking-conflict-100@10 | 100 | 10 | 195,31 req/s | 49 ms | 57 ms | 68 ms | 0 |
| booking-unique-100@25 | 100 | 25 | 335,57 req/s | 71 ms | 92 ms | 101 ms | 0 |
| booking-conflict-100@25 | 100 | 25 | 191,57 req/s | 120 ms | 159 ms | 181 ms | 0 |
| booking-unique-100@50 | 100 | 50 | 328,95 req/s | 129 ms | 181 ms | 205 ms | 0 |
| booking-conflict-100@50 | 100 | 50 | 202,02 req/s | 214 ms | 267 ms | 299 ms | 0 |
| booking-unique-500@25 | 500 | 25 | 367,11 req/s | 67 ms | 75 ms | 83 ms | 0 |
| booking-conflict-500@25 | 500 | 25 | 206,44 req/s | 119 ms | 135 ms | 140 ms | 0 |
| booking-unique-500@50 | 500 | 50 | 379,94 req/s | 129 ms | 140 ms | 172 ms | 0 |
| booking-conflict-500@50 | 500 | 50 | 213,40 req/s | 226 ms | 280 ms | 288 ms | 0 |
| shop-sales-100@25 | 100 | 25 | 68,78 req/s | 302 ms | 520 ms | 555 ms | 0 |
| shop-sales-500@50 | 500 | 50 | 70,52 req/s | 611 ms | 1118 ms | 1238 ms | 0 |
| kds-orders-100@25 | 100 | 25 | 105,71 req/s | 208 ms | 322 ms | 408 ms | 0 |
| kds-status-100@25 | 100 | 25 | 306,75 req/s | 79 ms | 95 ms | 102 ms | 0 |
| kds-orders-500@50 | 500 | 50 | 107,67 req/s | 411 ms | 767 ms | 1334 ms | 0 |
| kds-status-500@50 | 500 | 50 | 302,30 req/s | 160 ms | 185 ms | 209 ms | 0 |

Outbox après charge :

```text
PENDING     : 0
PROCESSING  : 0
PROCESSED   : 1872
FAILED      : 0
db_connections : 10
db_locks{waiting} : 0
```

### Interprétation

- La validation d'adhésion par requête ajoute une lecture PostgreSQL par
  requête authentifiée ; c'est le coût de la révocation immédiate.
- Les débits Booking/Shop/KDS sont inférieurs à la mesure Phase 3.
- Aucun lock en attente en fin de test.
- Le multi-tenant concurrent A/B et multi-instance reste **NOT-TESTED**.
