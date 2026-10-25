# Observabilité opérationnelle — GymSoinsHealthy

Ce dossier contient des définitions **provisionnables**, pas un déploiement
Prometheus/Grafana réel. Aucune infrastructure n'est inventée.

## Fichiers

- `prometheus/prometheus.yml` : scrape API, worker Outbox, worker rétention.
- `prometheus/alerts.yml` : règles d'alerte avec seuil, durée, gravité, action.
- `grafana/dashboards/gymsoins-overview.json` : dashboard production.
- `grafana/provisioning/*` : provisioning datasource + dashboard.

## Prérequis

1. `METRICS_TOKEN` configuré sur l'API (>= 16 caractères).
2. Token stocké dans `/etc/prometheus/secrets/gymsoins_metrics_token`
   (fichier 0600, jamais dans Git).
3. Workers exposés sur un réseau interne :
   - Outbox : `WORKER_HEALTH_HOST`, `WORKER_HEALTH_PORT=3002`
   - Rétention : `RETENTION_WORKER_HEALTH_HOST`, `RETENTION_WORKER_HEALTH_PORT=3003`
4. Adapter les cibles `api:3000`, `outbox-worker:3002`, `retention-worker:3003`
   à l'environnement réel.

## Endpoints

| Composant | Endpoint | Auth |
|---|---|---|
| API | `GET /internal/metrics` | Bearer `METRICS_TOKEN` |
| API admin | `GET /api/v1/observability/metrics` | JWT SUPER_ADMIN |
| API health | `GET /health` | public |
| API ready | `GET /ready` | public |
| Outbox worker | `GET /health`, `/ready`, `/metrics` | réseau interne |
| Retention worker | `GET /health`, `/ready`, `/metrics` | réseau interne |

## Métriques clés

### API

- `http_requests_total{method,route,status}`
- `http_errors_total{type,route}`
- `http_request_duration_ms_bucket`
- `db_connections`, `db_max_connections`, `db_locks{state}`
- `auth_events_total{action,success}`
- `auth_account_locked_total`

### Outbox

- `outbox_events{status}`
- `outbox_events_processed_total`
- `outbox_events_failed_total`
- `outbox_events_retried_total`
- `outbox_worker_up`
- `outbox_worker_heartbeat_timestamp_seconds`
- `outbox_worker_ticks_total`
- `outbox_worker_errors_total`

### Rétention

- `retention_worker_up`
- `retention_worker_heartbeat_timestamp_seconds`
- `retention_purge_ticks_total`
- `retention_purge_runs_total{result}`
- `retention_purge_errors_total`
- `retention_purge_skipped_locked_total`
- `retention_last_success_timestamp_seconds`
- `idempotency_keys_purged_total`
- `outbox_events_purged_total`

### KDS

- `kds_sse_connections_total`
- `kds_sse_disconnects_total`
- `kds_sse_active_connections`
- `kds_events_published_total{eventType}`
- `kds_poll_errors_total`

### Backup / restore

Écrites dans un fichier texte optionnel consommé par `node_exporter` :

- `gymsoins_backup_last_success_timestamp_seconds`
- `gymsoins_backup_last_failure_timestamp_seconds`
- `gymsoins_backup_last_size_bytes`
- `gymsoins_restore_last_success_timestamp_seconds`
- `gymsoins_restore_last_failure_timestamp_seconds`
- `gymsoins_restore_last_tables_checked`
- `gymsoins_restore_last_mismatches`

Exemple :

```bash
BACKUP_METRICS_FILE=/var/lib/node_exporter/textfile/gymsoins_backup.prom npm run backup
RESTORE_METRICS_FILE=/var/lib/node_exporter/textfile/gymsoins_restore.prom npm run verify:restore
```

Le workflow GitHub Actions échoue aussi si backup/restore/verify échoue. Une
alerte Prometheus sur l'ancienneté couvre l'absence de backup.

## Alertes

Chaque règle contient :

- expression PromQL ;
- seuil ;
- durée `for` ;
- gravité `warning` ou `critical` ;
- action attendue dans `annotations.action`.

Les seuils sont volontairement conservateurs et doivent être ajustés avec les
mesures réelles. Ne pas ajouter d'alerte sans seuil justifié.

## Validation locale

```bash
npm run validate:ops
```

Le script vérifie :

- YAML Prometheus valide ;
- règles avec `expr`, `for`, `severity`, `action` ;
- JSON Grafana valide ;
- dashboard non vide.
