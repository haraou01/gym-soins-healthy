# Runbook staging — Phase 4

## 1. État actuel

```text
remote Git : absent
staging host : absent
credentials staging : absents
Prometheus/Grafana déployés : non
```

Statut : **BLOCKED-EXTERNAL**. Aucun déploiement n'a été simulé.

## 2. Prérequis

### Dépôt distant

- URL du dépôt ;
- droit de push sur la branche cible ;
- protection de branche ;
- runner GitHub Actions rattaché.

### Secrets staging attendus

| Secret | Usage |
|---|---|
| `STAGING_HOST` | hôte SSH |
| `STAGING_USER` | utilisateur de déploiement |
| `STAGING_SSH_KEY` | clé privée |
| `STAGING_APP_DIR` | répertoire applicatif |
| `STAGING_DATABASE_URL` | PostgreSQL staging |
| `STAGING_JWT_SECRET` | >= 32 caractères |
| `STAGING_LICENSE_SECRET` | >= 32 caractères |
| `STAGING_METRICS_TOKEN` | scrape Prometheus |
| `STAGING_OTLP_ENDPOINT` | collecteur OTLP |
| `STAGING_CORS_ORIGINS` | frontend staging |
| `STAGING_APP_DB_PASSWORD` | rôle runtime `gymsoins_app` |
| `STAGING_WORKER_DB_PASSWORD` | rôle `gymsoins_worker` |
| `STAGING_RETENTION_DB_PASSWORD` | rôle `gymsoins_retention` |

Ne jamais committer ces valeurs.

## 3. Déploiement

```text
1. CI verte sur le commit SHA
2. build backend + frontend
3. artefact versionné par SHA
4. dump de sauvegarde staging
5. migrations explicites
6. déploiement API / workers / frontend
7. GET /health
8. GET /ready
9. smoke API admin
10. smoke multi-tenant A/B
11. smoke KDS SSE A/B
12. vérification version/commit
13. conservation des logs non sensibles
```

### Migrations

```bash
npm run db:migrate
APP_DB_PASSWORD="$STAGING_APP_DB_PASSWORD" \
WORKER_DB_PASSWORD="$STAGING_WORKER_DB_PASSWORD" \
RETENTION_DB_PASSWORD="$STAGING_RETENTION_DB_PASSWORD" \
npm run bootstrap:db-roles
npm run db:migrate   # doit appliquer 0 migration
```

L'API et les workers doivent utiliser les rôles runtime RLS, jamais le rôle
propriétaire/migration.

La migration ne doit jamais être lancée automatiquement sur production.

### Health / readiness

```bash
curl -fsS https://<staging>/health
curl -fsS https://<staging>/ready
```

`/health` expose `version` et `commit`. Le commit doit correspondre au SHA
déployé.

### Smoke multi-tenant

Créer deux tenants A et B via l'API staging, puis exécuter :

```bash
SSE_VERIFY_BASE_URL=https://<staging>/api/v1 npm run verify:kds-sse
RLS_SMOKE_BASE_URL=https://<staging>/api/v1 npm run verify:app-rls
```

Le script vérifie :

- A reçoit les événements A ;
- B ne reçoit pas A ;
- B reçoit B ;
- A ne reçoit pas B.

### Smoke workers

- `GET /metrics` du worker Outbox ;
- `outbox_worker_up 1` ;
- `outbox_events{status="FAILED"} 0` ;
- `GET /metrics` du worker rétention ;
- `retention_worker_up 1` ;
- rôles runtime non superuser/non BYPASSRLS ;
- policies RLS et `relforcerowsecurity=true`.

### Observabilité

- scrape `GET /internal/metrics` avec `METRICS_TOKEN` ;
- vérifier `db_connections`, `outbox_events`, `kds_sse_*` ;
- dashboard `gymsoins-overview` ;
- déclencher une alerte contrôlée en staging uniquement, avec accord.

## 4. Rollback

1. Arrêter les nouveaux processus.
2. Redémarrer l'artefact SHA précédent.
3. Ne pas rollback la base sans procédure explicite.
4. Si migration destructive : restaurer depuis backup vérifié.
5. Vérifier `/health`, `/ready`, smoke API et SSE.
6. Conserver les logs de l'incident.

Les migrations Phase 4 sont additives ; les colonnes historiques ne sont pas
supprimées.

## 5. Critères de sortie staging

- staging accessible ;
- CI distante exécutée sur le SHA ;
- migrations blank + second passage ;
- migration historique validée ;
- E2E et tests A/B verts ;
- smoke SSE A/B vert ;
- workers et rétention supervisés ;
- backup/restore vérifiés ;
- alertes/dashboard déployés ;
- version/commit visibles ;
- tests RLS et UI navigateur disponibles dans l'environnement.

Tant que ces éléments externes ne sont pas disponibles, le statut reste
**BLOCKED-EXTERNAL**.
