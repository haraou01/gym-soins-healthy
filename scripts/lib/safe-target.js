/**
 * Garde-fou centralisé pour les scripts de test/validation.
 *
 * Ne contient aucun secret et ne se connecte à aucune base.
 */

class UnsafeTargetError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnsafeTargetError';
    this.code = 'UNSAFE_DB_TARGET';
  }
}

const TEST_DB_PREFIXES = ['gymsoins_p5_iso_'];
const LEGACY_TEST_DATABASES = new Set([
  'gymsoins_test',
  'gymsoins_ci',
  'gymsoins_backup_source',
]);
const CI_EPHEMERAL_DATABASES = new Set([
  'gymsoins_migration_blank',
  'gymsoins_restore_check',
]);
const ALLOWED_55432_DATABASES = new Set([
  ...LEGACY_TEST_DATABASES,
  ...CI_EPHEMERAL_DATABASES,
]);

function normalizeTarget(input) {
  const host = String(input.host || '').trim();
  const port = Number(input.port);
  const database = String(input.database || '').trim();
  const mode = input.mode || 'write';

  if (!host) {
    throw new UnsafeTargetError('Hôte de base manquant.');
  }

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new UnsafeTargetError(`Port PostgreSQL invalide : ${input.port}.`);
  }

  if (!/^[A-Za-z0-9_]+$/.test(database)) {
    throw new UnsafeTargetError(`Nom de base invalide : ${database}.`);
  }

  if (!['destructive', 'migration', 'write', 'readonly'].includes(mode)) {
    throw new UnsafeTargetError(`Mode de cible invalide : ${mode}.`);
  }

  return { host, port, database, mode };
}

function assertSafeTestTarget(input, options = {}) {
  const target = normalizeTarget(input);
  const allowLegacyTestDb =
    options.allowLegacyTestDb ??
    process.env.ALLOW_LEGACY_TEST_DB === 'true';
  const allowRemoteHost =
    options.allowRemoteHost ??
    process.env.ALLOW_REMOTE_TEST_DB === 'true';

  if (!allowRemoteHost && !['127.0.0.1', 'localhost', '::1'].includes(target.host)) {
    throw new UnsafeTargetError(
      `Hôte non local refusé sans ALLOW_REMOTE_TEST_DB=true : ${target.host}.`,
    );
  }

  if (target.database === 'gymsoins_staging') {
    throw new UnsafeTargetError(
      'La base gymsoins_staging est interdite pour les tests.',
    );
  }

  if (target.database === 'postgres') {
    throw new UnsafeTargetError('La base postgres ne peut pas être une cible de test.');
  }

  if (target.port === 55432) {
    if (!allowLegacyTestDb) {
      throw new UnsafeTargetError(
        'Le port 55432 est refusé par défaut ; utiliser une cible staging isolée ou ALLOW_LEGACY_TEST_DB=true explicitement.',
      );
    }

    if (!ALLOWED_55432_DATABASES.has(target.database)) {
      throw new UnsafeTargetError(
        `Base 55432 non autorisée : ${target.database}.`,
      );
    }
  }

  if (target.port === 55433 && target.mode !== 'readonly') {
    if (!TEST_DB_PREFIXES.some((prefix) => target.database.startsWith(prefix))) {
      throw new UnsafeTargetError(
        `Base staging non isolée en mode ${target.mode} : ${target.database}.`,
      );
    }
  }

  return target;
}

function displayTarget(input) {
  const target = normalizeTarget({ ...input, mode: input.mode || 'readonly' });
  return `${target.host}:${target.port}/${target.database} (mode=${target.mode})`;
}

module.exports = {
  UnsafeTargetError,
  assertSafeTestTarget,
  displayTarget,
  normalizeTarget,
  LEGACY_TEST_DATABASES,
  CI_EPHEMERAL_DATABASES,
};
