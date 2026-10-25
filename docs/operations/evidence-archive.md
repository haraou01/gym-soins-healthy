# Archivage des preuves — Phase 5

## Principe

Les résultats de validation ne sont considérés comme archivés que si un fichier
de preuve et son empreinte SHA-256 sont conservés dans :

```text
artifacts/phase5/<label>-<timestamp>/
```

`artifacts/` est ignoré par Git : les preuves restent locales et ne peuvent pas
être publiées par accident avec le code.

## Commande

```bash
node scripts/archive-evidence.js \
  --label e2e \
  --source /tmp/gymsoins-e2e.log \
  --note "Suite E2E complète, base isolée 55433"
```

Le script :

- refuse les fichiers `.env*`, le compose staging et les clés privées ;
- refuse les contenus contenant un mot de passe, secret ou token assigné ;
- copie les sources dans `artifacts/phase5/` ;
- écrit `manifest.json` avec taille et SHA-256 ;
- n'affiche que le label, le répertoire et les chemins d'archive.

## Preuves disponibles

| Résultat | Archive | Statut |
|---|---|---|
| E2E/RLS 70/70 final | `artifacts/phase5/e2e-2026-10-25T22-08-32-680Z/` | archivé |
| UI Playwright | `artifacts/phase5/ui-2026-10-25T22-08-33-039Z/` | archivé |
| SSE KDS | `artifacts/phase5/sse-2026-10-25T22-08-33-268Z/` | archivé |
| OTel | `artifacts/phase5/otel-2026-10-25T22-08-33-506Z/` | archivé |
| Charge multi-tenant | `artifacts/phase5/load-2026-10-25T22-08-33-739Z/` | archivé |
| Backup base isolée | `artifacts/phase5/backup-2026-10-25T22-08-33-979Z/` | archivé |
| Runtime workers/KDS | `artifacts/phase5/workers-2026-10-25T22-08-34-107Z/` | archivé |
| Prometheus/alertes | `artifacts/phase5/prometheus-2026-10-25T22-08-34-475Z/` | archivé |
| Isolation DB | `artifacts/phase5/db-isolation-2026-10-25T22-08-34-352Z/` | archivé |
| Suppression base isolée | `artifacts/phase5/db-cleanup-2026-10-25T22-08-45-006Z/` | archivé |
| Vérification des manifestes | `artifacts/phase5/evidence-verify-2026-10-25T22-09-04-872Z/` | archivé |
| Tentatives échouées | `artifacts/phase5/*-attempt1-*` | archivé |
| Tests unitaires corrections | `artifacts/phase5/unit-*` et `unit-final-corrections-2026-10-25T22-33-14-048Z/` | archivé |
| Validation ops | `artifacts/phase5/ops-*` | archivé |
| Audit secrets | `artifacts/phase5/audit-*` | archivé |
| Build frontend | `artifacts/phase5/frontend-2026-10-25T22-28-42-179Z/` | archivé |
| Build backend corrections | `artifacts/phase5/build-corrections-2026-10-25T22-28-48-403Z/` | archivé |
| npm audit production | `artifacts/phase5/npm-audit-2026-10-25T22-28-42-179Z/` | archivé |
| Prometheus/Grafana snapshot lecture seule | `artifacts/phase5/observability-readonly-2026-10-25T22-28-42-179Z/` | archivé |
| Vérification SHA-256 corrections | `artifacts/phase5/evidence-verify-corrections-2026-10-25T22-28-56-171Z/`, `evidence-verify-final-corrections-2026-10-25T22-29-03-082Z/` et `evidence-verify-final2-corrections-2026-10-25T22-33-19-134Z/` | archivé |

Toutes les archives listées ci-dessus disposent d'un `manifest.json` avec
taille et SHA-256. Le compte courant est de **40 manifestes et 62 fichiers**.
La dernière vérification SHA-256 a couvert 39 manifestes et 61 fichiers avant
l'ajout de sa propre archive finale, sans écart
(`evidence-verify-final2-corrections-2026-10-25T22-33-19-134Z`).
Le compte 29/49 de la vérification historique reste un compte antérieur, pas
l'état courant.

Le restore/verify restore n'a pas été rejoué : il exige une seconde base cible
distincte, non autorisée par le périmètre de la revalidation runtime. Les scripts
`restore.js`, `migrate.js`, `bootstrap-db-roles.js`, `backup.js` et
`verify-restore.js` passent désormais par le garde-fou de cible avant toute
connexion.

Le smoke HTTP `verify:app-rls` et la résilience workers multi-processus restent
des **preuves de session non archivées** : ils nécessitent une base/des
processus et n'ont pas été rejoués dans la passe de corrections.

## Procédure future sûre

1. Vérifier la cible avec `node -e` ou le garde-fou du script.
2. Utiliser une base isolée sur `55433`, jamais `gymsoins_staging`.
3. Exécuter la suite avec `tee` vers un fichier `/tmp`.
4. Archiver le fichier avec `evidence:archive`.
5. Mettre à jour le rapport avec le chemin et le SHA-256 du manifeste.
