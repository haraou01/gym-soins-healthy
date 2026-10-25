type Env = Record<string, string | undefined>;

type Target = {
  host: string;
  port: number;
  database: string;
  mode: string;
};

const policies = require('../scripts/lib/db-target-policies') as {
  validateReadonlyTarget: (input: {
    host: string;
    port: number;
    database: string;
    env?: Env;
  }) => Target;
  validateMigrationTarget: (input: {
    host: string;
    port: number;
    database: string;
    env?: Env;
  }) => Target;
  validateRoleBootstrapTarget: (input: {
    host: string;
    port: number;
    database: string;
    env?: Env;
  }) => Target;
  validateRestoreTargets: (input: {
    host: string;
    port: number;
    sourceDatabase?: string;
    targetDatabase?: string;
    env?: Env;
  }) => { source: Target; target: Target };
  validateVerifyRestoreTargets: (input: {
    host: string;
    port: number;
    sourceDatabase?: string;
    targetDatabase?: string;
    env?: Env;
  }) => { source: Target; target: Target };
};

const isolated = 'gymsoins_p5_iso_123456';

describe('politiques de cible des scripts', () => {
  describe('restore.js', () => {
    it('accepte une cible destructive isolée sur 55433', () => {
      const result = policies.validateRestoreTargets({
        host: '127.0.0.1',
        port: 55433,
        sourceDatabase: 'gymsoins',
        targetDatabase: isolated,
        env: {},
      });

      expect(result.target).toMatchObject({
        database: isolated,
        mode: 'destructive',
      });
    });

    it('refuse gymsoins_staging avant toute connexion', () => {
      expect(() =>
        policies.validateRestoreTargets({
          host: '127.0.0.1',
          port: 55433,
          sourceDatabase: 'gymsoins',
          targetDatabase: 'gymsoins_staging',
          env: {},
        }),
      ).toThrow(/gymsoins_staging/);
    });

    it('refuse 55432 sans opt-in explicite', () => {
      expect(() =>
        policies.validateRestoreTargets({
          host: '127.0.0.1',
          port: 55432,
          sourceDatabase: 'gymsoins_backup_source',
          targetDatabase: 'gymsoins_restore_check',
          env: {},
        }),
      ).toThrow(/55432/);
    });

    it('accepte la base CI restore_check avec allowlist exacte', () => {
      const result = policies.validateRestoreTargets({
        host: '127.0.0.1',
        port: 55432,
        sourceDatabase: 'gymsoins_backup_source',
        targetDatabase: 'gymsoins_restore_check',
        env: { ALLOW_LEGACY_TEST_DB: 'true' },
      });

      expect(result.target.database).toBe('gymsoins_restore_check');
    });

    it('refuse une restauration sur la base source par défaut', () => {
      expect(() =>
        policies.validateRestoreTargets({
          host: '127.0.0.1',
          port: 5432,
          sourceDatabase: 'gymsoins',
          targetDatabase: 'gymsoins',
          env: {},
        }),
      ).toThrow(/base source/);
    });

    it('autorise la restauration sur la base source seulement avec override explicite', () => {
      expect(() =>
        policies.validateRestoreTargets({
          host: '127.0.0.1',
          port: 5432,
          sourceDatabase: 'gymsoins',
          targetDatabase: 'gymsoins',
          env: { ALLOW_RESTORE_OVER_PRIMARY: 'true' },
        }),
      ).not.toThrow();
    });
  });

  describe('migrate.js', () => {
    it('accepte une migration isolée sur 55433', () => {
      expect(
        policies.validateMigrationTarget({
          host: '127.0.0.1',
          port: 55433,
          database: isolated,
          env: {},
        }),
      ).toMatchObject({ database: isolated, mode: 'migration' });
    });

    it('refuse gymsoins_staging avant toute écriture', () => {
      expect(() =>
        policies.validateMigrationTarget({
          host: '127.0.0.1',
          port: 55433,
          database: 'gymsoins_staging',
          env: {},
        }),
      ).toThrow(/gymsoins_staging/);
    });

    it('refuse 55432 sans opt-in explicite', () => {
      expect(() =>
        policies.validateMigrationTarget({
          host: '127.0.0.1',
          port: 55432,
          database: 'gymsoins_migration_blank',
          env: {},
        }),
      ).toThrow(/55432/);
    });

    it('accepte la base CI migration_blank avec allowlist exacte', () => {
      expect(
        policies.validateMigrationTarget({
          host: '127.0.0.1',
          port: 55432,
          database: 'gymsoins_migration_blank',
          env: { ALLOW_LEGACY_TEST_DB: 'true' },
        }),
      ).toMatchObject({
        database: 'gymsoins_migration_blank',
        mode: 'migration',
      });
    });
  });

  describe('bootstrap-db-roles.js', () => {
    it('refuse les modifications de rôles sans activation explicite', () => {
      expect(() =>
        policies.validateRoleBootstrapTarget({
          host: '127.0.0.1',
          port: 55433,
          database: isolated,
          env: {},
        }),
      ).toThrow(/ALLOW_RUNTIME_ROLE_BOOTSTRAP/);
    });

    it('accepte une cible isolée avec activation explicite', () => {
      expect(
        policies.validateRoleBootstrapTarget({
          host: '127.0.0.1',
          port: 55433,
          database: isolated,
          env: { ALLOW_RUNTIME_ROLE_BOOTSTRAP: 'true' },
        }),
      ).toMatchObject({ database: isolated, mode: 'write' });
    });

    it('refuse gymsoins_staging même avec activation explicite', () => {
      expect(() =>
        policies.validateRoleBootstrapTarget({
          host: '127.0.0.1',
          port: 55433,
          database: 'gymsoins_staging',
          env: { ALLOW_RUNTIME_ROLE_BOOTSTRAP: 'true' },
        }),
      ).toThrow(/gymsoins_staging/);
    });
  });

  describe('backup.js et verify-restore.js', () => {
    it('refuse la lecture de gymsoins_staging', () => {
      expect(() =>
        policies.validateReadonlyTarget({
          host: '127.0.0.1',
          port: 55433,
          database: 'gymsoins_staging',
          env: {},
        }),
      ).toThrow(/gymsoins_staging/);
    });

    it('accepte la source backup 55432 avec opt-in et allowlist', () => {
      expect(
        policies.validateReadonlyTarget({
          host: '127.0.0.1',
          port: 55432,
          database: 'gymsoins_backup_source',
          env: { ALLOW_LEGACY_TEST_DB: 'true' },
        }),
      ).toMatchObject({ database: 'gymsoins_backup_source', mode: 'readonly' });
    });

    it('refuse une vérification restore sur la même base', () => {
      expect(() =>
        policies.validateVerifyRestoreTargets({
          host: '127.0.0.1',
          port: 55433,
          sourceDatabase: isolated,
          targetDatabase: isolated,
          env: {},
        }),
      ).toThrow(/différentes/);
    });
  });
});
