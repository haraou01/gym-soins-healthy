import { getTestDatabaseSettings } from './utils/test-database';

describe('settings de test — garde-fou intégré', () => {
  const keys = [
    'TEST_PG_HOST',
    'TEST_PG_PORT',
    'TEST_PG_DATABASE',
    'TEST_RESET_RUNTIME_ROLES',
    'ALLOW_LEGACY_TEST_DB',
  ];
  const original = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of keys) {
      original.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of keys) {
      const value = original.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('refuse la configuration par défaut 55432', () => {
    expect(() => getTestDatabaseSettings()).toThrow(/55432/);
  });

  it('refuse gymsoins_staging même avec une base isolée en apparence', () => {
    process.env.TEST_PG_PORT = '55433';
    process.env.TEST_PG_DATABASE = 'gymsoins_staging';

    expect(() => getTestDatabaseSettings()).toThrow(/gymsoins_staging/);
  });

  it('accepte une base isolée 55433 et laisse resetRuntimeRoles à false', () => {
    process.env.TEST_PG_PORT = '55433';
    process.env.TEST_PG_DATABASE = 'gymsoins_p5_iso_123456';

    const settings = getTestDatabaseSettings();

    expect(settings.port).toBe(55433);
    expect(settings.database).toBe('gymsoins_p5_iso_123456');
    expect(settings.resetRuntimeRoles).toBe(false);
  });

  it('active resetRuntimeRoles uniquement sur demande explicite', () => {
    process.env.TEST_PG_PORT = '55433';
    process.env.TEST_PG_DATABASE = 'gymsoins_p5_iso_123456';
    process.env.TEST_RESET_RUNTIME_ROLES = 'true';

    expect(getTestDatabaseSettings().resetRuntimeRoles).toBe(true);
  });
});
