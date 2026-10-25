#!/usr/bin/env node

/**
 * Active les rôles runtime RLS avec des mots de passe fournis par
 * l'environnement. Ne jamais committer ces mots de passe.
 *
 * Variables attendues :
 *   POSTGRES_* (rôle propriétaire/migration)
 *   APP_DB_PASSWORD
 *   WORKER_DB_PASSWORD
 *   RETENTION_DB_PASSWORD
 */
require('dotenv').config();

const { Client } = require('pg');
const {
  validateRoleBootstrapTarget,
  displayTarget,
} = require('./lib/db-target-policies');

const owner = {
  host: process.env.POSTGRES_HOST || 'localhost',
  port: Number(process.env.POSTGRES_PORT || 5432),
  user: process.env.POSTGRES_USERNAME || 'admin',
  password: process.env.POSTGRES_PASSWORD || '',
  database: process.env.POSTGRES_DATABASE || 'gymsoins',
};

const roles = [
  ['gymsoins_app', process.env.APP_DB_PASSWORD],
  ['gymsoins_worker', process.env.WORKER_DB_PASSWORD],
  ['gymsoins_retention', process.env.RETENTION_DB_PASSWORD],
];

async function main() {
  // Double protection : cible autorisée et activation explicite avant toute
  // connexion ou modification des rôles runtime.
  const target = validateRoleBootstrapTarget({
    host: owner.host,
    port: owner.port,
    database: owner.database,
    env: process.env,
  });
  console.log(`[safe-target] cible ${displayTarget(target)}`);

  for (const [name, password] of roles) {
    if (!password || password.length < 12) {
      throw new Error(
        `Mot de passe manquant ou trop court pour ${name} (>= 12 caractères).`,
      );
    }
  }

  const client = new Client(owner);
  await client.connect();

  try {
    for (const [name, password] of roles) {
      await client.query(
        `DO $$
         BEGIN
           IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${name}') THEN
             CREATE ROLE ${name} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
           END IF;
         END
         $$;`,
      );

      const sqlResult = await client.query(
        `SELECT format('ALTER ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %L', $1::text, $2::text) AS sql`,
        [name, password],
      );
      await client.query(sqlResult.rows[0].sql);
    }

    process.stdout.write(
      `${JSON.stringify({
        event: 'db.roles.bootstrapped',
        roles: roles.map(([name]) => name),
        timestamp: new Date().toISOString(),
      })}\n`,
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({
      event: 'db.roles.bootstrap_failed',
      error: error instanceof Error ? error.message : String(error),
    })}\n`,
  );
  process.exit(1);
});
