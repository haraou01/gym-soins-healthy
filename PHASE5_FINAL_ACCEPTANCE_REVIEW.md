# PHASE5_FINAL_ACCEPTANCE_REVIEW

## 0. Méthode et limites

Revue finale mise à jour après les corrections post-revue, sans commit, push,
déploiement, reset Git ni migration destructive.

- Aucune connexion à PostgreSQL pendant cette passe de correction.
- Aucune connexion à `127.0.0.1:55432`, `gymsoins_test`, `gymsoins_staging` ni
  à leurs volumes/mots de passe.
- Aucun secret affiché ; aucun mot de passe runtime modifié.
- Les tests nécessitant une base ou des processus n'ont pas été rejoués.
- Les preuves de session non archivées restent explicitement qualifiées comme
  telles.

Les corrections ont modifié des fichiers existants et ajouté des tests/outils.
Elles ne constituent ni un commit ni une validation runtime supplémentaire.

---

## 1. État Git

```text
Branche : main
HEAD    : e458c90 feat: enforce PostgreSQL RLS and complete phase 5 validation
Remote  : aucun (`git remote -v` vide)
Staged  : aucun fichier
```

Contrôles :

```text
git status --short --branch : working tree non propre, aucun staged
git diff --check             : OK, exit 0
git diff --stat              : 28 fichiers suivis, 498 insertions, 114 suppressions
git diff --cached --stat     : vide
```

Fichiers non suivis : 21, dont les rapports Phase 5, les scripts de garde-fou,
les tests unitaires, les bootstraps workers et les configurations Prometheus
staging. `PHASE5_FINAL_ACCEPTANCE_REVIEW.md` fait partie de ces fichiers non
suivis.

`PHASE5_ACCEPTANCE_REVIEW.md` reste une revue historique antérieure (9 fichiers
modifiés / 3 non suivis) ; elle ne décrit pas l'état courant.

### Secrets

- `.env.staging` et `docker-compose.staging.yml` restent non suivis et ignorés.
- `artifacts/phase5/**` reste ignoré par Git.
- `scripts/audit-secrets.js` ne scanne que `git ls-files` ; les nouveaux fichiers
  non suivis ne sont donc pas couverts par l'audit automatique.
- Un scan manuel des fichiers en attente n'a trouvé aucun secret de production.
  Les correspondances restantes sont des fixtures, valeurs de développement ou
  placeholders.
- L'audit automatique devra être relancé après indexation, avant un éventuel
  commit.

---

## 2. Corrections de sécurité appliquées

### 2.1 Garde-fou central

`scripts/lib/safe-target.js` :

- refuse `gymsoins_staging` sans exception et la base `postgres` ;
- refuse `55432` par défaut ;
- avec `ALLOW_LEGACY_TEST_DB=true`, n'accepte que l'allowlist exacte :
  `gymsoins_test`, `gymsoins_ci`, `gymsoins_backup_source`,
  `gymsoins_migration_blank`, `gymsoins_restore_check` ;
- n'utilise `gymsoins_test` que pour le legacy local ; la CI n'utilise pas cette
  base ;
- exige le préfixe `gymsoins_p5_iso_` sur `55433` pour tout mode non lecture
  (`migration`, `write`, `destructive`) ;
- refuse un hôte non local sans `ALLOW_REMOTE_TEST_DB=true` ;
- n'affiche que `host:port/database` et le mode, jamais de mot de passe.

Les modes sont désormais explicites : `readonly`, `migration`, `write`,
`destructive`.

### 2.2 `scripts/restore.js` — P0

La cible est validée **avant** la lecture de sauvegarde, la connexion admin et
toute commande `DROP`/`CREATE`/`pg_restore` :

- cible en mode `destructive` ;
- source en mode `readonly` ;
- refus de `gymsoins_staging`, de `55432` sans opt-in/allowlist et de `55433`
  hors préfixe isolé ;
- restauration sur la base source refusée sauf
  `ALLOW_RESTORE_OVER_PRIMARY=true` explicite ;
- tests unitaires sans connexion DB dans
  `test/db-target-policies.unit-spec.ts`.

### 2.3 `scripts/migrate.js`

La migration utilise le mode `migration` et valide la cible avant l'ouverture de
la connexion. Une migration sur `gymsoins_staging`, sur `55432` sans
opt-in/allowlist ou sur `55433` hors préfixe isolé est refusée avant toute
écriture.

### 2.4 `scripts/bootstrap-db-roles.js`

Le script :

- passe par le garde-fou en mode `write` avant toute connexion ;
- exige `ALLOW_RUNTIME_ROLE_BOOTSTRAP=true` ;
- refuse `gymsoins_staging` et les cibles non isolées ;
- n'affiche jamais les mots de passe ;
- échoue avant toute modification si la cible ou l'activation est invalide.

Aucun mot de passe runtime réel n'a été modifié pendant cette correction.

### 2.5 `backup.js` et `verify-restore.js`

Les deux scripts en lecture seule passent désormais par le garde-fou avant
connexion. Ils refusent `gymsoins_staging` et les cibles `55432` non
allowlistées.

### 2.6 Workflows CI

`.github/workflows/ci.yml` :

- `npm run test:unit` est exécuté sans base ;
- `node scripts/ci-db-guard.js gymsoins_migration_blank destructive` est exécuté
  avant le `DROP`/`CREATE` direct ;
- `ALLOW_LEGACY_TEST_DB=true` est explicite sur l'étape de migration ;
- `gymsoins_migration_blank` est dans l'allowlist CI exacte.

`.github/workflows/backup-restore.yml` :

- `node scripts/ci-db-guard.js gymsoins_restore_check destructive` est exécuté
  avant le `DROP`/`CREATE` direct ;
- `gymsoins_restore_check` est dans l'allowlist CI exacte ;
- `restore`, `db:migrate` et `verify:restore` utilisent les scripts désormais
  gardés.

`55432` n'est jamais autorisé globalement ; `gymsoins_test` n'est pas utilisé
par la CI. `TEST_RESET_RUNTIME_ROLES=true` reste une activation explicite et
limitée aux bases éphémères `gymsoins_ci` et `gymsoins_backup_source` ; aucune
base staging/production n'est ciblée. Les deux workflows YAML ont été chargés
avec succès par un parseur YAML local.

---

## 3. Tests et preuves exécutés

### 3.1 Tests unitaires

```text
npm run test:unit : 6 suites, 38/38 tests PASS
Aucune connexion DB
```

Archive : `artifacts/phase5/unit-final-corrections-2026-10-25T22-33-14-048Z/`.

Les tests couvrent notamment :

- `safe-target` et ses allowlists ;
- les politiques restore/migrate/bootstrap/backup/verify ;
- la désactivation KDS et la configuration workers ;
- le reset des rôles runtime opt-in.

### 3.2 Builds et audit

```text
Backend  : npm run build PASS
Frontend : build Vite PASS
npm audit --omit=dev --audit-level=high : exit 0
npm audit --omit=dev --json : exit 1 attendu pour 6 moderate
```

Archives :

- `artifacts/phase5/build-corrections-2026-10-25T22-28-48-403Z/` ;
- `artifacts/phase5/frontend-2026-10-25T22-28-42-179Z/` ;
- `artifacts/phase5/npm-audit-2026-10-25T22-28-42-179Z/`.

### 3.3 Observabilité locale

Un snapshot **lecture seule** de Prometheus/Grafana locaux a été archivé :

`artifacts/phase5/observability-readonly-2026-10-25T22-28-42-179Z/`.

Il montre :

- Prometheus `/-/ready` 200, 3 cibles UP ;
- Grafana 11.3.0, datasource et dashboard 9 panneaux ;
- `GymSoinsStagingAlertPipelineTest` `firing` au snapshot ;
- `GymSoinsKdsPollErrors` encore `firing` sur l'ancienne pile
  `:3000`/`:3102`/`:3103`.

Ce snapshot ne prouve ni la résolution/re-déclenchement de l'alerte de test, ni
le runtime isolé final. Le runtime isolé final reste couvert par
`artifacts/phase5/workers-2026-10-25T22-08-34-107Z/` (KDS désactivé sur les
workers, rétention opérationnelle).

### 3.4 Preuves archivées et vérification SHA-256

Compte courant : **40 manifestes / 62 fichiers**.

La dernière vérification SHA-256 a couvert 39 manifestes / 61 fichiers avant
l'ajout de sa propre archive finale :

```text
Écarts SHA-256 : 0
Fichiers absents : 0
```

Archive : `artifacts/phase5/evidence-verify-final2-corrections-2026-10-25T22-33-19-134Z/`.

### 3.5 Preuves non archivées ou non exécutées

Restent explicitement qualifiées :

- `verify:app-rls` : preuve de session non archivée ;
- workers multi-processus : preuve de session non archivée ;
- résolution/re-déclenchement de l'alerte de test Prometheus : preuve de session
  non archivée ;
- intégrité staging (migrations/tables/policies) : preuve de session non
  archivée ;
- restore/verify restore : `NOT RUN`, seconde base cible non autorisée ;
- UI Playwright en CI, CI distante, staging externe, Alertmanager externe,
  résilience API multi-hôte : `BLOCKED-EXTERNAL` / `NOT RUN`.

---

## 4. Documentation corrigée

Les documents suivants ont été resynchronisés :

- `PHASE5_VALIDATION_REPORT.md` ;
- `docs/operations/phase-5-validation-matrix.md` ;
- `docs/operations/phase5-runtime-revalidation.md` ;
- `docs/operations/evidence-archive.md` ;
- `test/README.md` ;
- `docs/load-tests.md` ;
- `ops/README.md`.

Corrections principales :

- allowlist legacy/CI exacte et statut legacy de `gymsoins_test` ;
- compatibilité CI réelle (`ci-db-guard`, `test:unit`, bases éphémères) ;
- compte de manifestes 40/62 et vérification 39/61 ;
- valeurs p95 resynchronisées sur le log de charge archivé :
  Booking A/B 139/169 ms, Shop A/B 688/819 ms ;
- procédure runtime marquée comme exécutée le 2026-10-25, avec restore `NOT RUN` ;
- preuves de session explicitement distinguées des preuves SHA-256 ;
- snapshot Prometheus/Grafana décrit sans masquer les alertes encore `firing`.

---

## 5. Risques résiduels et limites

1. `restore.js` et `verify-restore.js` sont désormais gardés, mais restore n'a
   pas été exécuté faute de seconde base cible autorisée.
2. Le smoke `verify:app-rls`, les workers multi-processus et la résolution de
   l'alerte de test restent des preuves de session non archivées.
3. L'audit secrets automatique ne couvre que les fichiers suivis ; il doit être
   relancé après indexation. Le scan manuel des fichiers en attente n'a trouvé
   aucun secret de production.
4. Deux anciennes bases isolées (`gymsoins_p5_iso_1792959906`,
   `gymsoins_p5_iso_1792959928`) restent visibles ; la base de la session
   `gymsoins_p5_iso_1792965162` a été supprimée.
5. L'UI conserve des `consoleErrors` non bloquants (`ERR_NAME_NOT_RESOLVED`,
   401/409 attendus).
6. Les alertes `GymSoinsOutboxFailed` (fixtures) et
   `GymSoinsBackupMetricsMissing` restent visibles sur la pile de test.
7. Les contrôles externes restent non exécutés : CI distante, staging
   applicatif, Alertmanager, API multi-hôte, Playwright en CI.

Ces points sont documentés et ne sont pas des défauts locaux de sécurité,
d'isolation DB, de KDS, de worker, de RLS, de tests ou d'observabilité.

---

## 6. Décision finale

# ACCEPTÉ POUR COMMIT

Les défauts locaux bloquants de la revue précédente sont corrigés :

- garde-fou intégré dans `restore.js`, `migrate.js`,
  `bootstrap-db-roles.js`, `backup.js` et `verify-restore.js` ;
- allowlist CI exacte et minimale, sans autorisation globale de `55432` ;
- `test:unit` exécuté par la CI ;
- tests unitaires 38/38 et tests de garde-fou sans connexion DB ;
- preuves frontend, npm audit, build, unit et observabilité archivées ;
- documentation resynchronisée, preuves de session clairement qualifiées.

Les limitations externes et les preuves de session restantes sont correctement
documentées et ne bloquent pas le commit local.

Aucun commit, push ou déploiement n'a été effectué.
