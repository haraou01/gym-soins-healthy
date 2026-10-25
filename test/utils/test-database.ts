import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import * as bcrypt from 'bcryptjs';

export const TEST_ADMIN_EMAIL = 'admin.e2e@gymsoins.local';
export const TEST_ADMIN_PASSWORD = 'AdminE2E123!';
export const TEST_ADMIN_ROLE = 'SUPER_ADMIN';

export const TEST_JWT_SECRET = 'e2e-jwt-secret-do-not-use-in-production';
export const TEST_LICENSE_SECRET = 'e2e-license-secret-do-not-use-in-production';

export interface TestDatabaseSettings {
  host: string;
  port: number;
  user: string;
  password: string;
  adminDatabase: string;
  database: string;
}

const SAFE_IDENTIFIER = /^[A-Za-z0-9_]+$/;

export function getTestDatabaseSettings(): TestDatabaseSettings {
  return {
    host: process.env.TEST_PG_HOST ?? 'localhost',
    port: Number(process.env.TEST_PG_PORT ?? 55432),
    user: process.env.TEST_PG_USER ?? 'gymsoins',
    password: process.env.TEST_PG_PASSWORD ?? 'gymsoins',
    adminDatabase: process.env.TEST_PG_ADMIN_DB ?? 'postgres',
    database: process.env.TEST_PG_DATABASE ?? 'gymsoins_test',
  };
}

/** Attend que PostgreSQL accepte les connexions (utile juste après `docker compose up`). */
export async function waitForDatabase(
  settings: TestDatabaseSettings,
  attempts = 30,
  delayMs = 1_000,
): Promise<void> {
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

  for (const migration of migrations) {
    const sql = readFileSync(join(migrationsDirectory, migration), 'utf8');
    await client.query(sql);
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

  const passwordHash = await bcrypt.hash(TEST_ADMIN_PASSWORD, 10);

  await client.query(
    `INSERT INTO users (email, username, password_hash, role_id, is_active)
     VALUES ($1, $2, $3, (SELECT id FROM roles WHERE name = $4), TRUE)
     ON CONFLICT (email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           role_id = EXCLUDED.role_id,
           is_active = TRUE`,
    [TEST_ADMIN_EMAIL, 'E2E Admin', passwordHash, TEST_ADMIN_ROLE],
  );
}
