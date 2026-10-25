import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import * as bcrypt from 'bcryptjs';

const {
  assertSafeTestTarget,
  displayTarget,
} = require('../../scripts/lib/safe-target') as {
  assertSafeTestTarget: (input: {
    host: string;
    port: number;
    database: string;
    mode: string;
  }) => { host: string; port: number; database: string; mode: string };
  displayTarget: (input: {
    host: string;
    port: number;
    database: string;
    mode?: string;
  }) => string;
};

export const TEST_ADMIN_EMAIL = 'admin.e2e@gymsoins.local';
export const TEST_ADMIN_PASSWORD = 'AdminE2E123!';
export const TEST_ADMIN_ROLE = 'SUPER_ADMIN';
export const TEST_TENANT_ID = '00000000-0000-0000-0000-000000000001';
export const TEST_RECEPTIONIST_EMAIL = 'receptionist.e2e@gymsoins.local';
export const TEST_RECEPTIONIST_PASSWORD = 'ReceptionistE2E123!';
export const TEST_RECEPTIONIST_ROLE = 'RECEPTIONIST';

export const TEST_RUNTIME_USER = 'gymsoins_app';
export const TEST_RUNTIME_PASSWORD = 'e2e-app-runtime-password-2026';
export const TEST_WORKER_USER = 'gymsoins_worker';
export const TEST_WORKER_PASSWORD = 'e2e-worker-runtime-password-2026';
export const TEST_RETENTION_USER = 'gymsoins_retention';
export const TEST_RETENTION_PASSWORD = 'e2e-retention-runtime-password-2026';

export const TEST_JWT_SECRET = 'e2e-jwt-secret-do-not-use-in-production';
export const TEST_LICENSE_SECRET = 'e2e-license-secret-do-not-use-in-production';

export interface TestDatabaseSettings {
  host: string;
  port: number;
  user: string;
  password: string;
  adminDatabase: string;
  database: string;
  runtimeUser: string;
  runtimePassword: string;
  workerUser: string;
  workerPassword: string;
  retentionUser: string;
  retentionPassword: string;
  resetRuntimeRoles: boolean;
}

const SAFE_IDENTIFIER = /^[A-Za-z0-9_]+$/;

export function getTestDatabaseSettings(): TestDatabaseSettings {
  const settings: TestDatabaseSettings = {
    host: process.env.TEST_PG_HOST ?? 'localhost',
    port: Number(process.env.TEST_PG_PORT ?? 55432),
    user: process.env.TEST_PG_USER ?? 'gymsoins',
    password: process.env.TEST_PG_PASSWORD ?? 'gymsoins',
    adminDatabase: process.env.TEST_PG_ADMIN_DB ?? 'postgres',
    database: process.env.TEST_PG_DATABASE ?? 'gymsoins_test',
    runtimeUser: process.env.TEST_PG_RUNTIME_USER ?? TEST_RUNTIME_USER,
    runtimePassword:
      process.env.TEST_PG_RUNTIME_PASSWORD ?? TEST_RUNTIME_PASSWORD,
    workerUser: process.env.TEST_PG_WORKER_USER ?? TEST_WORKER_USER,
    workerPassword:
      process.env.TEST_PG_WORKER_PASSWORD ?? TEST_WORKER_PASSWORD,
    retentionUser:
      process.env.TEST_PG_RETENTION_USER ?? TEST_RETENTION_USER,
    retentionPassword:
      process.env.TEST_PG_RETENTION_PASSWORD ?? TEST_RETENTION_PASSWORD,
    resetRuntimeRoles: process.env.TEST_RESET_RUNTIME_ROLES === 'true',
  };

  assertSafeTestTarget({
    host: settings.host,
    port: settings.port,
    database: settings.database,
    mode: 'destructive',
  });

  return settings;
}

/** Attend que PostgreSQL accepte les connexions (utile juste après `docker compose up`). */
export async function waitForDatabase(
  settings: TestDatabaseSettings,
  attempts = 30,
  delayMs = 1_000,
): Promise<void> {
  assertSafeTestTarget({
    host: settings.host,
    port: settings.port,
    database: settings.database,
    mode: 'destructive',
  });

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const client = new Client({
      host: settings.host,
      port: settings.port,
      user: settings.user,
      password: settings.password,
      database: settings.adminDatabase,
    });

    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error(
    `PostgreSQL de test injoignable sur ${settings.host}:${settings.port} — ` +
      `lancez « npm run db:test:up ». Dernière erreur : ${String(lastError)}`,
  );
}

/**
 * Recrée une base de test vierge à partir des migrations SQL du projet,
 * puis insère les rôles RBAC et le compte SUPER_ADMIN utilisé par les tests.
 */
export async function resetTestDatabase(
  settings: TestDatabaseSettings,
): Promise<void> {
  if (!SAFE_IDENTIFIER.test(settings.database)) {
    throw new Error(`Nom de base de test invalide : ${settings.database}`);
  }

  const target = assertSafeTestTarget({
    host: settings.host,
    port: settings.port,
    database: settings.database,
    mode: 'destructive',
  });

  process.stdout.write(
    `[test-db] cible autorisée : ${displayTarget({
      ...target,
      mode: 'destructive',
    })}\n`,
  );

  const connection = {
    host: settings.host,
    port: settings.port,
    user: settings.user,
    password: settings.password,
  };

  const admin = new Client({ ...connection, database: settings.adminDatabase });
  await admin.connect();

  try {
    await admin.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [settings.database],
    );
    await admin.query(`DROP DATABASE IF EXISTS "${settings.database}"`);
    await admin.query(`CREATE DATABASE "${settings.database}"`);
  } finally {
    await admin.end();
  }

  const client = new Client({ ...connection, database: settings.database });
  await client.connect();

  try {
    await runMigrations(client);

    if (settings.resetRuntimeRoles) {
      await ensureRuntimeRoles(client, settings);
    } else {
      await assertRuntimeRolesExist(client, settings);
    }

    await seedRolesAndAdmin(client);
  } finally {
    await client.end();
  }
}

async function runMigrations(client: Client): Promise<void> {
  const migrationsDirectory = join(process.cwd(), 'src', 'database', 'migrations');
  const migrations = readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  for (const migration of migrations) {
    const sql = readFileSync(join(migrationsDirectory, migration), 'utf8');
    await client.query(sql);
    await client.query(
      `INSERT INTO schema_migrations (name) VALUES ($1)
       ON CONFLICT (name) DO NOTHING`,
      [migration],
    );
  }
}

async function assertRuntimeRolesExist(
  client: Client,
  settings: TestDatabaseSettings,
): Promise<void> {
  const roles = [
    settings.runtimeUser,
    settings.workerUser,
    settings.retentionUser,
  ];

  for (const role of roles) {
    const result = await client.query(
      'SELECT 1 FROM pg_roles WHERE rolname = $1 AND rolcanlogin = true AND rolsuper = false AND rolbypassrls = false',
      [role],
    );

    if (result.rowCount !== 1) {
      throw new Error(
        `Rôle runtime staging absent ou non conforme : ${role}`,
      );
    }
  }
}

async function ensureRuntimeRoles(
  client: Client,
  settings: TestDatabaseSettings,
): Promise<void> {
  const roles = [
    [settings.runtimeUser, settings.runtimePassword],
    [settings.workerUser, settings.workerPassword],
    [settings.retentionUser, settings.retentionPassword],
  ] as const;

  for (const [role, password] of roles) {
    if (!/^[a-z_][a-z0-9_]*$/.test(role)) {
      throw new Error(`Nom de rôle runtime invalide : ${role}`);
    }

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
          CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
        END IF;
      END
      $$;
    `);

    const alter = await client.query(
      `SELECT format('ALTER ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %L', $1::text, $2::text) AS sql`,
      [role, password],
    );
    await client.query(alter.rows[0].sql);
  }
}

async function seedRolesAndAdmin(client: Client): Promise<void> {
  const roles = ['SUPER_ADMIN', 'RECEPTIONIST', 'COACH', 'THERAPIST', 'CHEF'];

  for (const role of roles) {
    await client.query(
      'INSERT INTO roles (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
      [role],
    );
  }

  await seedUserMembership(client, {
    email: TEST_ADMIN_EMAIL,
    username: 'E2E Admin',
    password: TEST_ADMIN_PASSWORD,
    role: TEST_ADMIN_ROLE,
  });

  await seedUserMembership(client, {
    email: TEST_RECEPTIONIST_EMAIL,
    username: 'E2E Receptionist',
    password: TEST_RECEPTIONIST_PASSWORD,
    role: TEST_RECEPTIONIST_ROLE,
  });
}

async function seedUserMembership(
  client: Client,
  input: { email: string; username: string; password: string; role: string },
): Promise<void> {
  const passwordHash = await bcrypt.hash(input.password, 10);

  const userResult = await client.query(
    `INSERT INTO users (email, username, password_hash, role_id, is_active)
     VALUES ($1, $2, $3, (SELECT id FROM roles WHERE name = $4), TRUE)
     ON CONFLICT (email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           role_id = EXCLUDED.role_id,
           is_active = TRUE
     RETURNING id`,
    [input.email, input.username, passwordHash, input.role],
  );

  const userId = userResult.rows[0].id;
  const tenantResult = await client.query(
    `INSERT INTO tenants (id, slug, name, status)
     VALUES ($1, 'legacy', 'Legacy tenant', 'ACTIVE')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TEST_TENANT_ID],
  );
  const tenantId = tenantResult.rows[0].id;

  await client.query(
    `INSERT INTO tenant_memberships ("tenantId", "userId", "roleId", status)
     VALUES ($1, $2, (SELECT id FROM roles WHERE name = $3), 'ACTIVE')
     ON CONFLICT ("tenantId", "userId") DO UPDATE
       SET "roleId" = EXCLUDED."roleId",
           status = 'ACTIVE'`,
    [tenantId, userId, input.role],
  );
}
