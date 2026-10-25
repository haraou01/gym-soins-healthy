#!/usr/bin/env node

/**
 * Valide une cible CI avant toute commande psql destructive.
 *
 * Usage :
 *   node scripts/ci-db-guard.js <database> [mode]
 *
 * La cible reste soumise à l'allowlist exacte de safe-target.js. Le port
 * 55432 n'est jamais autorisé globalement : ALLOW_LEGACY_TEST_DB=true et une
 * base éphémère nommée explicitement restent nécessaires.
 */

const {
  assertSafeTestTarget,
  displayTarget,
  CI_EPHEMERAL_DATABASES,
} = require('./lib/safe-target');

const database = process.argv[2];
const mode = process.argv[3] || 'destructive';

if (!database) {
  console.error('Usage: node scripts/ci-db-guard.js <database> [mode]');
  process.exit(2);
}

// Ce garde-fou est réservé aux bases éphémères CI. Il ne doit jamais accepter
// gymsoins_test, gymsoins_ci, gymsoins_backup_source ou une base applicative.
if (!CI_EPHEMERAL_DATABASES.has(database)) {
  console.error(
    `[safe-target] base CI non autorisée : ${database}. Allowlist : ${Array.from(
      CI_EPHEMERAL_DATABASES,
    ).join(', ')}.`,
  );
  process.exit(1);
}

try {
  const target = assertSafeTestTarget({
    host: process.env.POSTGRES_HOST || '127.0.0.1',
    port: Number(process.env.POSTGRES_PORT || 55432),
    database,
    mode,
  });

  console.log(`[safe-target] cible ${displayTarget(target)}`);
} catch (error) {
  console.error(
    `[safe-target] refusée : ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
