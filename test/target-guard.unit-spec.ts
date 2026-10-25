const {
  UnsafeTargetError,
  assertSafeTestTarget,
  displayTarget,
} = require('../scripts/lib/safe-target') as {
  UnsafeTargetError: new (message: string) => Error & { code?: string };
  assertSafeTestTarget: (
    input: {
      host: string;
      port: number;
      database: string;
      mode: string;
    },
    options?: {
      allowLegacyTestDb?: boolean;
      allowRemoteHost?: boolean;
    },
  ) => { host: string; port: number; database: string; mode: string };
  displayTarget: (input: {
    host: string;
    port: number;
    database: string;
    mode?: string;
  }) => string;
};

describe('garde-fou des cibles de test', () => {
  const originalLegacy = process.env.ALLOW_LEGACY_TEST_DB;
  const originalRemote = process.env.ALLOW_REMOTE_TEST_DB;

  afterEach(() => {
    if (originalLegacy === undefined) {
      delete process.env.ALLOW_LEGACY_TEST_DB;
    } else {
      process.env.ALLOW_LEGACY_TEST_DB = originalLegacy;
    }

    if (originalRemote === undefined) {
      delete process.env.ALLOW_REMOTE_TEST_DB;
    } else {
      process.env.ALLOW_REMOTE_TEST_DB = originalRemote;
    }
  });

  it('refuse la base principale staging', () => {
    expect(() =>
      assertSafeTestTarget({
        host: '127.0.0.1',
        port: 55433,
        database: 'gymsoins_staging',
        mode: 'destructive',
      }),
    ).toThrow(UnsafeTargetError);
  });

  it('refuse 55432 par défaut', () => {
    delete process.env.ALLOW_LEGACY_TEST_DB;

    expect(() =>
      assertSafeTestTarget({
        host: '127.0.0.1',
        port: 55432,
        database: 'gymsoins_test',
        mode: 'destructive',
      }),
    ).toThrow(/55432/);
  });

  it('accepte 55432 uniquement avec autorisation explicite et base de test', () => {
    expect(() =>
      assertSafeTestTarget(
        {
          host: '127.0.0.1',
          port: 55432,
          database: 'gymsoins_test',
          mode: 'destructive',
        },
        { allowLegacyTestDb: true },
      ),
    ).not.toThrow();
  });

  it('refuse une base 55432 non explicitement allowlistée même avec opt-in', () => {
    expect(() =>
      assertSafeTestTarget(
        {
          host: '127.0.0.1',
          port: 55432,
          database: 'gymsoins_autre',
          mode: 'destructive',
        },
        { allowLegacyTestDb: true },
      ),
    ).toThrow(/non autorisée/);
  });

  it('garde gymsoins_test hors de l’allowlist CI éphémère', () => {
    const { CI_EPHEMERAL_DATABASES } = require('../scripts/lib/safe-target') as {
      CI_EPHEMERAL_DATABASES: Set<string>;
    };

    expect(CI_EPHEMERAL_DATABASES.has('gymsoins_test')).toBe(false);
    expect(Array.from(CI_EPHEMERAL_DATABASES).sort()).toEqual([
      'gymsoins_migration_blank',
      'gymsoins_restore_check',
    ]);
  });

  it('accepte uniquement les bases CI éphémères explicitement allowlistées', () => {
    for (const database of [
      'gymsoins_migration_blank',
      'gymsoins_restore_check',
    ]) {
      expect(() =>
        assertSafeTestTarget(
          {
            host: '127.0.0.1',
            port: 55432,
            database,
            mode: 'destructive',
          },
          { allowLegacyTestDb: true },
        ),
      ).not.toThrow();
    }
  });

  it('refuse une migration non isolée sur 55433', () => {
    expect(() =>
      assertSafeTestTarget({
        host: '127.0.0.1',
        port: 55433,
        database: 'gymsoins_test',
        mode: 'migration',
      }),
    ).toThrow(/non isolée/);
  });

  it('accepte une migration isolée sur 55433', () => {
    expect(
      assertSafeTestTarget({
        host: '127.0.0.1',
        port: 55433,
        database: 'gymsoins_p5_iso_123456',
        mode: 'migration',
      }),
    ).toMatchObject({ database: 'gymsoins_p5_iso_123456', mode: 'migration' });
  });

  it('refuse une base destructive non isolée sur 55433', () => {
    expect(() =>
      assertSafeTestTarget({
        host: '127.0.0.1',
        port: 55433,
        database: 'gymsoins_test',
        mode: 'destructive',
      }),
    ).toThrow(/isolée/);
  });

  it('accepte une base staging isolée sur 55433', () => {
    expect(
      assertSafeTestTarget({
        host: '127.0.0.1',
        port: 55433,
        database: 'gymsoins_p5_iso_123456',
        mode: 'destructive',
      }),
    ).toMatchObject({
      host: '127.0.0.1',
      port: 55433,
      database: 'gymsoins_p5_iso_123456',
    });
  });

  it('refuse un hôte distant sans autorisation explicite', () => {
    expect(() =>
      assertSafeTestTarget({
        host: '10.0.0.12',
        port: 55433,
        database: 'gymsoins_p5_iso_123456',
        mode: 'destructive',
      }),
    ).toThrow(/Hôte non local/);
  });

  it('refuse un port invalide', () => {
    expect(() =>
      assertSafeTestTarget({
        host: '127.0.0.1',
        port: 0,
        database: 'gymsoins_p5_iso_123456',
        mode: 'destructive',
      }),
    ).toThrow(/Port PostgreSQL invalide/);
  });

  it('affiche une cible sans secret', () => {
    expect(
      displayTarget({
        host: '127.0.0.1',
        port: 55433,
        database: 'gymsoins_p5_iso_123456',
        mode: 'destructive',
      }),
    ).toBe('127.0.0.1:55433/gymsoins_p5_iso_123456 (mode=destructive)');
  });
});
