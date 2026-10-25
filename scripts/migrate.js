#!/usr/bin/env node

/**
 * Runner de migrations SQL.
 *
 * - Charge `.env` si présent.
 * - Crée la table `schema_migrations`.
 * - Applique les fichiers `src/database/migrations/*.sql` dans l'ordre.
 * - Chaque migration est exécutée dans une transaction.
 * - Une migration déjà enregistrée est ignorée.
 *
 * Utilisation :
 *   npm run db:migrate
 */

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const migrationsDirectory = path.join(
  __dirname,
  '..',
  'src',
  'database',
  'migrations',
);

const databaseConfig = {
  host: process.env.POSTGRES_HOST || 'localhost',
  port: Number(process.env.POSTGRES_PORT || 5432),
  user: process.env.POSTGRES_USERNAME || 'admin',
  password: process.env.POSTGRES_PASSWORD || '',
  database: process.env.POSTGRES_DATABASE || 'gymsoins',
};

async function main() {
  const client = new Client(databaseConfig);

  try {
    await client.connect();

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const files = fs
      .readdirSync(migrationsDirectory)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    if (process.argv.includes('--baseline')) {
      let marked = 0;

      for (const file of files) {
        const result = await client.query(
          `INSERT INTO schema_migrations (name)
           VALUES ($1)
           ON CONFLICT (name) DO NOTHING`,
          [file],
        );
        marked += result.rowCount ?? 0;
      }

      console.log(
        `Baseline terminée : ${marked} migration(s) marquée(s) comme appliquée(s).`,
      );
      return;
    }

    const appliedResult = await client.query(
      'SELECT name FROM schema_migrations',
    );
    const applied = new Set(appliedResult.rows.map((row) => row.name));

    let appliedCount = 0;
    let skippedCount = 0;

    for (const file of files) {
      if (applied.has(file)) {
        skippedCount += 1;
        console.log(`↷ ${file} (déjà appliquée)`);
        continue;
      }

      const sql = fs.readFileSync(
        path.join(migrationsDirectory, file),
        'utf8',
      );

      await client.query('BEGIN');

      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (name) VALUES ($1)',
          [file],
        );
        await client.query('COMMIT');
        appliedCount += 1;
        console.log(`✓ ${file}`);
      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`✗ ${file}`);
        throw error;
      }
    }

    console.log(
      `\n${appliedCount} migration(s) appliquée(s), ${skippedCount} déjà à jour.`,
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
