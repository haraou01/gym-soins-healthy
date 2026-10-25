# Staging & CI/CD distante — état et prérequis

## Constat

```text
git remote -v : aucun remote configuré
infrastructure staging : non fournie dans l'environnement
credentials de déploiement : absents
```

Ces éléments sont **BLOCKED EXTERNAL**. Aucun remote, host, token ou
infrastructure n'a été inventé.

## CI locale validée

Le workflow `.github/workflows/ci.yml` couvre :

1. install backend/frontend ;
2. audit secrets ;
3. validation des assets observabilité ;
4. build backend ;
5. build frontend ;
6. migration base vierge ;
7. second passage migration ;
8. E2E ;
9. vérification OTLP ;
10. smoke worker rétention ;
11. audit dépendances production ;
12. artefact `npm-audit`.

Les commandes équivalentes ont été exécutées localement avec succès.

## Ce qui manque pour la CI distante

- un dépôt Git distant accessible ;
- un runner GitHub Actions rattaché au dépôt ;
- les secrets CI nécessaires ;
- un environnement staging ;
- une cible de déploiement.

## Secrets attendus pour staging

Ne jamais committer ces valeurs.

| Secret | Usage |
|---|---|
| `STAGING_HOST` | hôte SSH staging |
| `STAGING_USER` | utilisateur de déploiement |
| `STAGING_SSH_KEY` | clé privée de déploiement |
| `STAGING_APP_DIR` | répertoire de l'application |
| `STAGING_DATABASE_URL` | connexion PostgreSQL staging |
| `STAGING_JWT_SECRET` | JWT >= 32 caractères |
| `STAGING_LICENSE_SECRET` | licence >= 32 caractères |
| `STAGING_METRICS_TOKEN` | scrape Prometheus |
| `STAGING_OTLP_ENDPOINT` | collecteur OTLP |
| `STAGING_CORS_ORIGINS` | origines frontend |

## Pipeline staging cible

```text
CI verte
  ↓
build artefact versionné (commit SHA)
  ↓
migration explicite (jamais automatique en production)
  ↓
déploiement staging
  ↓
GET /health
  ↓
GET /ready
  ↓
smoke API
  ↓
smoke KDS SSE (ticket + événement)
  ↓
vérification version/commit exposé
  ↓
logs de déploiement
```

## Rollback

1. Conserver l'artefact précédent et son SHA.
2. En cas d'échec health/ready/smoke :
   - arrêter le nouveau processus ;
   - redémarrer l'artefact précédent ;
   - ne pas rollback la base sans procédure explicite ;
   - si une migration destructive a été appliquée, restaurer depuis backup
     vérifié, jamais improviser.
3. Les migrations doivent rester backward-compatible autant que possible.

## Règles

- Aucune opération destructive automatique en production.
- Migrations staging explicites et traçables.
- Un déploiement doit exposer `version` et `commit` via `/health`.
- Le workflow backup/restore existant reste actif.
- Aucun secret dans les logs ou artefacts.

## Décision

| Élément | Statut |
|---|---|
| CI workflow défini et commandes locales validées | PASS (local) |
| Exécution CI distante | BLOCKED EXTERNAL |
| Remote Git | BLOCKED EXTERNAL |
| Staging déployé | BLOCKED EXTERNAL |
| Smoke staging | BLOCKED EXTERNAL |

La Phase 3 ne peut pas être déclarée terminée sur ces critères externes.
