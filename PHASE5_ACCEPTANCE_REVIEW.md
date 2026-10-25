# PHASE5_ACCEPTANCE_REVIEW

> **Document historique.** Cette revue a précédé les corrections finales. Sa
> décision `CORRECTIONS REQUISES` est obsolète ; la décision courante est
> `ACCEPTÉ POUR COMMIT` dans `PHASE5_FINAL_ACCEPTANCE_REVIEW.md`.

## 1. Périmètre et méthode

Revue indépendante en lecture seule des changements non commités et des preuves
de la validation Phase 5.

Contraintes respectées :

- aucune base `55432` contactée ;
- `gymsoins_staging` non réinitialisée ;
- aucune migration, aucun reset Git, aucun push, aucun déploiement ;
- aucun secret affiché ;
- aucun fichier applicatif modifié par cette revue ;
- seules des commandes de lecture, `git diff`, requêtes Prometheus/HTTP et
  lectures de logs ont été exécutées.

Limite : les tests E2E/UI/SSE n'ont pas été relancés pendant la revue, car leur
exécution implique un reset de base ou des écritures de fixtures. Ils sont
donc acceptés sous réserve de leurs preuves de session.

---

## 2. État Git et diff

```text
Branche : main
Commit de référence : e458c90
Working tree : 9 fichiers modifiés, 3 fichiers non suivis
```

Fichiers modifiés :

```text
.gitignore
docs/load-tests.md
docs/operations/phase-5-validation-matrix.md
ops/README.md
ops/prometheus/alerts.yml
scripts/validate-ops.js
test/integration.e2e-spec.ts
test/rls.e2e-spec.ts
test/utils/test-database.ts
```

Fichiers non suivis :

```text
PHASE5_VALIDATION_REPORT.md
ops/prometheus/alerts.staging-test.yml
ops/prometheus/prometheus.staging.yml
```

Contrôles :

```text
git diff --check : aucune erreur
git diff --stat : 135 insertions / 33 suppressions dans les 9 fichiers suivis
.env.staging : ignoré, non suivi
docker-compose.staging.yml : ignoré, non supprimé, non modifié
```

Le fichier compose contient un `POSTGRES_PASSWORD` ; il est correctement exclu
du suivi Git par `.gitignore`.

---

## 3. Revue de la configuration Prometheus

### Production

`ops/prometheus/prometheus.yml` charge uniquement :

```text
/etc/prometheus/alerts.yml
```

La règle `GymSoinsStagingAlertPipelineTest` n'est **pas** incluse dans
`alerts.yml` et n'est pas chargée par la configuration de production.

### Staging

`ops/prometheus/prometheus.staging.yml` charge :

```text
/etc/prometheus/alerts.yml
/etc/prometheus/alerts.staging-test.yml
```

La règle de test est explicitement limitée au staging.
Conclusion : **séparation production/staging acceptée**.

### Filtrage des alertes workers

Les expressions ont été corrigées pour filtrer le `job` réel :

```text
GymSoinsOutboxWorkerDown
GymSoinsOutboxWorkerHeartbeatStale
GymSoinsRetentionWorkerDown
GymSoinsRetentionStale
```

Cela supprime les faux positifs provenant de l'API qui expose
`outbox_worker_up=0` / `retention_worker_up=0` lorsque les workers in-process
sont désactivés.

Résultat observé :

```text
Cibles Prometheus : API up, worker Outbox up, worker rétention up
Aucune alerte GymSoinsOutboxWorkerDown active
Aucune alerte GymSoinsRetentionWorkerDown active
```

### Point non résolu détecté

Prometheus expose actuellement :

```text
GymSoinsKdsPollErrors : firing
job = gymsoins-retention-worker
kds_poll_errors_total = 485
```

L'API principale n'expose pas ce compteur. Le worker de rétention exécute
pourtant `KdsEventsService`, qui interroge toutes les secondes
`list_kds_outbox_events()`. Le rôle `gymsoins_retention` n'a pas l'exécution de
cette fonction ; chaque tick échoue et incrémente `kds_poll_errors_total`.

Ce n'est pas un faux positif de la règle d'alerte : c'est un défaut réel de
composition du processus de rétention.

---

## 4. Revue des tests et de la sécurité des cibles

### Protection des rôles runtime

Le changement `TEST_RESET_RUNTIME_ROLES=false` permet de tester sur le cluster
staging sans modifier les mots de passe des rôles `gymsoins_app`,
`gymsoins_worker` et `gymsoins_retention`.

Mais la valeur par défaut reste **true** :

```text
resetRuntimeRoles = TEST_RESET_RUNTIME_ROLES !== 'false'
```

Un lancement accidentel des tests sur le cluster staging sans cette variable
réinitialiserait les mots de passe runtime. C'est un risque opérationnel.

### Cibles destructives et port 55432

`resetTestDatabase()` supprime et recrée la base `TEST_PG_DATABASE`. Les
valeurs par défaut et plusieurs scripts pointent encore vers `55432` et
`gymsoins_test` :

```text
test/utils/test-database.ts      55432, gymsoins_test
scripts/load-test-multitenant.js 55432, gymsoins_test
scripts/verify-ui-tenant.js      55432, gymsoins_test
scripts/verify-kds-tenant-sse.js 55432, gymsoins_test
scripts/verify-otel.js           55432, gymsoins_test
```

Aucun garde-fou n'interdit :

- `TEST_PG_DATABASE=gymsoins_staging` ;
- `POSTGRES_DATABASE=gymsoins_staging` ;
- une exécution destructive sur `55432` ;
- un nom de base non explicitement isolé.

Le rapport annonce que les tests ont utilisé une base isolée sur `55433`, ce qui
est exact pour l'exécution effectuée, mais **le dépôt ne garantit pas** cette
isolation. Un opérateur peut accidentellement cibler staging principal ou
`55432`.

Conclusion : **protection accidentelle rejetée**.

### Tests de licence

`test/integration.e2e-spec.ts` force désormais :

```text
LICENSE_DEV_MODE=false
```

Cela évite qu'un environnement staging active le mode développement et rende
les tests de signature permissifs. Correction acceptée.

### Tests RLS

`test/rls.e2e-spec.ts` utilise maintenant les identifiants runtime issus de
`getTestDatabaseSettings()` au lieu des constantes de test locales. Cela permet
d'utiliser les mots de passe staging sans les modifier. Correction acceptée,
sous réserve du garde-fou de cible ci-dessus.

---

## 5. Preuves et annonces du rapport

### Preuves présentes

| Résultat | Preuve consultée | Statut |
|---|---|---|
| Charge multi-tenant | `/tmp/p5-load-isolated.json` | ACCEPTÉ |
| Backup/restore | `/tmp/p5-iso-backup.log`, `/tmp/p5-iso-restore.log` | ACCEPTÉ |
| Workers/Observabilité | `/tmp/p5-obs-worker.log`, `/tmp/p5-obs-retention.log`, targets Prometheus | ACCEPTÉ avec réserve KDS |
| Prometheus/Grafana | cibles Prometheus UP, `/api/health`, dashboard 9 panneaux | ACCEPTÉ |
| Alerte test | `GymSoinsStagingAlertPipelineTest` firing, puis résolution/re-fire observés | ACCEPTÉ |
| Audit secrets | dernière exécution 292 fichiers, 0 finding | ACCEPTÉ |
| Build backend/frontend | commandes exécutées, succès | ACCEPTÉ |

### Preuves non archivées

- E2E 70/70 : résultat de session, aucun fichier de sortie Jest conservé.
- UI Playwright : résultat de session, aucun rapport/screenshot conservé.
- SSE : résultat de session, aucun JSON de preuve conservé.
- OTel : résultat de session, aucun export OTLP archivé.

Ces résultats ne sont pas reproductibles à partir du dépôt seul sans relancer
des commandes qui écrivent en base. Ils sont **acceptés sous réserve** ou
doivent être rejoués et archivés.

### Divergence constatée

`PHASE5_VALIDATION_REPORT.md` affirme :

```text
Aucun critère obligatoire local ne reste en échec après correction.
```

Or Prometheus expose actuellement une alerte réelle :

```text
GymSoinsKdsPollErrors firing
```

Le worker rétention fonctionne pour la purge, mais il génère des erreurs KDS
répétées non mentionnées dans le rapport. Cette affirmation est **inexacte**
dans l'état actuel.

---

## 6. Défauts classés par gravité

### P0 — Critique

1. **Erreurs KDS permanentes dans le worker rétention**
   - `KdsEventsService` démarre dans le processus rétention ;
   - le rôle `gymsoins_retention` n'a pas l'exécution de
     `list_kds_outbox_events()` ;
   - 485 erreurs de poll observées, alerte `GymSoinsKdsPollErrors` firing.

2. **Absence de garde-fou empêchant une cible destructive accidentelle**
   - `resetTestDatabase` peut supprimer `gymsoins_staging` si l'environnement
     est mal configuré ;
   - les scripts destructifs par défaut ciblent `55432` ;
   - `ensureRuntimeRoles` peut réinitialiser les mots de passe runtime staging
     par défaut.

### P1 — Élevé

3. **Preuves E2E/UI/SSE non archivées**
   - résultats annoncés mais non rejouables sans écriture/reset ;
   - le rapport ne distingue pas suffisamment preuve archivée et preuve de
     session.

4. **Affirmation « aucun critère local en échec » contredite**
   - alerte KDS réelle active ;
   - rapport à corriger après résolution.

### P2 — Moyen

5. **Détection d'arrêt worker dépendante de `absent`**
   - `GymSoinsOutboxWorkerDown` peut attendre la staleness Prometheus ;
   - ajouter une alerte `up{job="gymsoins-outbox-worker"} == 0` ou équivalent.

6. **Détection rétention lente**
   - `GymSoinsRetentionWorkerDown` a un `for: 30m` ;
   - acceptable pour une purge 6 h, mais à justifier dans la policy.

7. **Dashboard/alertes locaux seulement**
   - conforme au périmètre local, non représentatif d'un staging externe.

---

## 7. Corrections recommandées

### Correction 1 — Désactiver KDS dans les workers non-API

- Ajouter `KDS_EVENTS_ENABLED` (défaut API `true`) ;
- `KdsEventsService.onModuleInit()` ne démarre pas si désactivé ;
- `worker.ts` et `retention-worker.ts` forcent `false` ;
- ajouter un test vérifiant que `retention_worker` n'expose pas
  `kds_poll_errors_total` en augmentation.

Alternative non recommandée : accorder l'exécution à
`gymsoins_retention`, ce qui ferait poller inutilement tous les événements KDS.

### Correction 2 — Garde-fou de cible test

Dans `test/utils/test-database.ts` et les scripts :

- refuser `database === 'gymsoins_staging'` sauf autorisation explicite ;
- refuser une base non préfixée `gymsoins_p5_` / `gymsoins_test_` en mode
  destructif ;
- refuser `port === 55432` pour une validation staging sauf
  `ALLOW_LEGACY_TEST_DB=true` ;
- rendre `resetRuntimeRoles` explicitement opt-in
  (`TEST_RESET_RUNTIME_ROLES=true`) plutôt que par défaut ;
- imprimer uniquement `host:port/database` avant reset, jamais les secrets.

### Correction 3 — Archivage des preuves

- sauvegarder la sortie Jest dans un artefact ;
- archiver le JSON UI/SSE ;
- conserver un export OTLP ou un résumé de spans ;
- référencer les fichiers dans le rapport.

### Correction 4 — Alertes worker

- ajouter une alerte sur `up{job="gymsoins-outbox-worker"} == 0` ;
- ajouter la même vérification pour la rétention ;
- conserver les filtres `job` actuels.

### Correction 5 — Rapport

Après correction, mettre à jour `PHASE5_VALIDATION_REPORT.md` pour retirer
l'affirmation « aucun critère local en échec » tant que l'alerte KDS reste
active.

---

## 8. Critères d'acceptation

### ACCEPTÉS

- Séparation production/staging des règles Prometheus.
- Absence de la règle de test dans la configuration de production.
- Filtrage `job` des alertes workers.
- Intégrité lecture seule du staging (29 migrations, 31 tables, 45 policies,
  21 FORCE RLS, rôles conformes).
- Backup/restore 31 tables / 29 migrations / 0 mismatch.
- Charge multi-tenant A/B avec 0 mismatch cross-tenant.
- Correction `LICENSE_DEV_MODE=false`.
- Isolation des rôles runtime via les settings de test.
- `.env.staging` et compose staging ignorés.

### REJETÉS / CORRECTIONS REQUISES

- Worker rétention qui pollue KDS et alerte réellement en erreur.
- Absence de garde-fou contre la base staging principale et le port 55432.
- Reset par défaut des mots de passe runtime staging.
- Preuves E2E/UI/SSE non archivées.
- Affirmation du rapport contredite par l'alerte KDS active.

### BLOQUÉS

- CI distante : aucun remote Git.
- Déploiement staging externe : aucune infrastructure applicative.
- Alerting externe : pas d'Alertmanager.
- Résilience API multi-hôte/load-balancer : non exécutée.
- UI Playwright en CI.

---

## 9. Décision

# CORRECTIONS REQUISES

Le socle RLS, les tests SQL, la charge A/B, les workers multi-processus, le
backup/restore et l'observabilité locale sont largement démontrés.

Mais la revue n'accepte pas le commit en l'état à cause de :

1. l'alerte réelle `GymSoinsKdsPollErrors` causée par le worker rétention ;
2. l'absence de garde-fous empêchant une cible accidentelle `gymsoins_staging`
   ou `55432` ;
3. le reset par défaut des mots de passe runtime ;
4. les preuves E2E/UI/SSE non archivées ;
5. l'affirmation du rapport contredite par l'état Prometheus actuel.

Aucun commit, push ou déploiement n'a été effectué.
