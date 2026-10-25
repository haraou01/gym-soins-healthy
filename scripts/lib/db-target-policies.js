/**
 * Politiques de cible pour les scripts qui écrivent ou lisent PostgreSQL.
 *
 * Ce module ne se connecte à aucune base et ne contient aucun secret. Il
 * centralise les règles afin que restore/migrate/bootstrap/backup/verify
 * utilisent exactement le même garde-fou que les suites de test.
 */

const {
  assertSafeTestTarget,
  displayTarget,
} = require('./safe-target');

function safeOptions(env) {
  return {
    allowLegacyTestDb: env.ALLOW_LEGACY_TEST_DB === 'true',
    allowRemoteHost: env.ALLOW_REMOTE_TEST_DB === 'true',
  };
}

function validateTarget({ host, port, database, mode, env = process.env }) {
  return assertSafeTestTarget(
    { host, port, database, mode },
    safeOptions(env),
  );
}

function validateReadonlyTarget(input) {
  return validateTarget({ ...input, mode: 'readonly' });
}

function validateMigrationTarget(input) {
  return validateTarget({ ...input, mode: 'migration' });
}

function validateRoleBootstrapTarget(input) {
  const env = input.env || process.env;

  if (env.ALLOW_RUNTIME_ROLE_BOOTSTRAP !== 'true') {
    throw new Error(
      'Modification des rôles runtime refusée : définir ALLOW_RUNTIME_ROLE_BOOTSTRAP=true explicitement.',
    );
  }

  return validateTarget({ ...input, mode: 'write', env });
}

function validateRestoreTargets({
  host,
  port,
  sourceDatabase = 'gymsoins',
  targetDatabase,
  env = process.env,
}) {
  if (!targetDatabase) {
    throw new Error('RESTORE_DATABASE est obligatoire.');
  }

  const source = validateReadonlyTarget({
    host,
    port,
    database: sourceDatabase,
    env,
  });
  const target = validateTarget({
    host,
    port,
    database: targetDatabase,
    mode: 'destructive',
    env,
  });

  if (source.database === target.database && env.ALLOW_RESTORE_OVER_PRIMARY !== 'true') {
    throw new Error(
      'Restauration refusée sur la base source. Définir ALLOW_RESTORE_OVER_PRIMARY=true pour forcer.',
    );
  }

  return { source, target };
}

function validateVerifyRestoreTargets({
  host,
  port,
  sourceDatabase = 'gymsoins',
  targetDatabase,
  env = process.env,
}) {
  if (!targetDatabase) {
    throw new Error('RESTORE_DATABASE est obligatoire.');
  }

  const source = validateReadonlyTarget({
    host,
    port,
    database: sourceDatabase,
    env,
  });
  const target = validateReadonlyTarget({
    host,
    port,
    database: targetDatabase,
    env,
  });

  if (source.database === target.database) {
    throw new Error('Les bases source et cible doivent être différentes.');
  }

  return { source, target };
}

module.exports = {
  validateReadonlyTarget,
  validateMigrationTarget,
  validateRoleBootstrapTarget,
  validateRestoreTargets,
  validateVerifyRestoreTargets,
  displayTarget,
};
