# Audit dépendances — Phase 3

## Commandes

```bash
npm audit --json
npm audit --omit=dev --json
npm audit --omit=dev --audit-level=high
```

## Résultat global

| Périmètre | Critical | High | Moderate | Low | Total |
|---|---:|---:|---:|---:|---:|
| Toutes dépendances | 0 | 4 | 12 | 3 | 19 |
| Production uniquement | 0 | 0 | 6 | 0 | 6 |

Le gate CI est :

```bash
npm audit --omit=dev --audit-level=high
```

Il passe : aucune vulnérabilité **high ou critical** en production.

## Remédiations appliquées

1. **Suppression de Bull/Redis inutilisés**
   - `@nestjs/bull`, `bull`, `@types/bull`, `redis` retirés.
   - Aucun code métier ne les utilisait : Redis n'est pas nécessaire.
   - Suppression de `BullModule` et `redisFactory`.

2. **Overrides de sécurité** :
   - `body-parser` → `1.20.9`
   - `multer` → `2.5.0`
   - `qs` → `6.16.1`
   - `lodash` → `4.18.1`
   - `uuid` → `11.1.1`

3. **Validation après overrides** :
   - build backend OK ;
   - E2E 47/47 OK ;
   - OTel OTLP OK.

## Vulnérabilités production restantes (6 moderate)

| Package | Type | Version | Correction | Décision |
|---|---|---|---|---|
| `@nestjs/common` | direct | 10.4.22 | upgrade Nest 12 | différé, breaking majeur |
| `@nestjs/core` | direct | 10.4.22 | Nest 12.2.0 | différé, breaking majeur |
| `@nestjs/event-emitter` | direct | 2.1.1 | 12.0.1 | différé, breaking majeur |
| `@nestjs/platform-express` | direct | 10.4.22 | 12.2.0 | différé, breaking majeur |
| `@nestjs/typeorm` | direct | 10.0.2 | 12.0.2 | différé, breaking majeur |
| `file-type` | transitif | 20.4.1 | 22.2.0 (ESM) | risque non exploitable : aucun upload de fichier exposé |

### Analyse

- Les vulnérabilités Nest restantes nécessitent une migration majeure Nest 10 → 12.
  Une migration aveugle n'est pas acceptable sans campagne de tests dédiée.
- `file-type` est utilisé par `@nestjs/common` pour la validation d'upload.
  L'application n'expose aucun endpoint d'upload de fichier.
- `uuid` a été corrigé via override et validé par build/E2E.
- `body-parser`/`multer`/`qs`/`lodash` ont été corrigés sans changement majeur
  du framework.

## Vulnérabilités dev restantes

Elles concernent principalement `@nestjs/cli` et ses dépendances transitives
(`webpack`, `glob`, `tmp`, `picomatch`, `inquirer`, `ajv`, Angular devkit).
Elles ne sont pas embarquées dans le runtime de production. La correction
nécessite un upgrade majeur du CLI, à planifier séparément.

## Risques acceptés

1. Nest 10 reste sur des versions modérées signalées, sans correctif non
   breaking. Migration Nest 12 à planifier.
2. `file-type` non exploitable dans le périmètre actuel (pas d'upload).
3. `npm audit` ne remplace pas un scan SCA/container en CI avancée.

## Décision

- **Production high/critical : PASS.**
- **Production moderate : FAIL partiel / accepté avec plan de migration.**
- **Dev high : FAIL partiel / non runtime, upgrade CLI à planifier.**
