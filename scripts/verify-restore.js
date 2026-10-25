require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const {
  validateVerifyRestoreTargets,
  displayTarget,
} = require('./lib/db-target-policies');

const sourceDatabase = process.env.POSTGRES_DATABASE || 'gymsoins';
const targetDatabase = process.env.RESTORE_DATABASE;

const settings = {
  host: process.env.POSTGRES_HOST || 'localhost',
  port: Number(process.env.POSTGRES_PORT || 5432),
  user: process.env.POSTGRES_USERNAME || 'admin',
  password: process.env.POSTGRES_PASSWORD || '',
};

function client(database) {
  return new Client({ ...settings, database });
}

function writeMetrics(values) {
  const file = process.env.RESTORE_METRICS_FILE;
  if (!file) {
    return;
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = [
    '# HELP gymsoins_restore_last_success_timestamp_seconds Dernière vérification restore réussie',
    '# TYPE gymsoins_restore_last_success_timestamp_seconds gauge',
    ...Object.entries(values).map(([key, value]) => `${key} ${value}`),
  ];
  fs.writeFileSync(file, `${lines.join('\n')}\n`, { mode: 0o644 });
}

async function main() {
  if (!targetDatabase) {
    throw new Error('RESTORE_DATABASE est obligatoire.');
  }

  // Vérification en lecture seule des deux cibles avant toute connexion.
  const targets = validateVerifyRestoreTargets({
    host: settings.host,
    port: settings.port,
    sourceDatabase,
    targetDatabase,
    env: process.env,
  });
  console.log(`[safe-target] cible ${displayTarget(targets.target)}`);

  const source = client(sourceDatabase);
  const target = client(targetDatabase);

  await source.connect();
  await target.connect();

  try {
    const sourceTables = await source.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
    );

    const targetTables = await target.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
    );

    const sourceNames = sourceTables.rows.map((row) => row.table_name);
    const targetNames = targetTables.rows.map((row) => row.table_name);
    const mismatches = [];
    const counts = {};

    for (const table of sourceNames) {
      if (!targetNames.includes(table)) {
        mismatches.push({ table, source: 'present', target: 'missing' });
        continue;
      }

      const sourceCount = await source.query(
        `SELECT COUNT(*)::int AS count FROM "${table}"`,
      );
      const targetCount = await target.query(
        `SELECT COUNT(*)::int AS count FROM "${table}"`,
      );

      counts[table] = {
        source: sourceCount.rows[0].count,
        target: targetCount.rows[0].count,
      };

      if (counts[table].source !== counts[table].target) {
        mismatches.push({
          table,
          source: counts[table].source,
          target: counts[table].target,
        });
      }
    }

    for (const table of targetNames) {
      if (!sourceNames.includes(table)) {
        mismatches.push({ table, source: 'missing', target: 'present' });
      }
    }

    const migrations = await target.query(
      'SELECT COUNT(*)::int AS count FROM schema_migrations',
    );

    const smoke = {
      users: (
        await target.query('SELECT COUNT(*)::int AS count FROM users')
      ).rows[0].count,
      settings: (
        await target.query('SELECT COUNT(*)::int AS count FROM settings')
      ).rows[0].count,
      roles: (
        await target.query('SELECT COUNT(*)::int AS count FROM roles')
      ).rows[0].count,
    };

    if (
      migrations.rows[0].count === 0 ||
      smoke.users === 0 ||
      smoke.roles === 0
    ) {
      mismatches.push({
        table: 'smoke',
        source: 'expected data',
        target: JSON.stringify({ migrations: migrations.rows[0].count, ...smoke }),
      });
    }

    process.stdout.write(
      `${JSON.stringify({
        event: mismatches.length === 0 ? 'restore.verified' : 'restore.invalid',
        sourceDatabase,
        targetDatabase,
        tablesChecked: sourceNames.length,
        migrations: migrations.rows[0].count,
        smoke,
        mismatches,
        timestamp: new Date().toISOString(),
      })}\n`,
    );

    if (mismatches.length > 0) {
      process.exitCode = 1;
      writeMetrics({
        gymsoins_restore_last_failure_timestamp_seconds: Date.now() / 1_000,
        gymsoins_restore_last_mismatches: mismatches.length,
      });
    } else {
      writeMetrics({
        gymsoins_restore_last_success_timestamp_seconds: Date.now() / 1_000,
        gymsoins_restore_last_tables_checked: sourceNames.length,
        gymsoins_restore_last_mismatches: 0,
      });
    }
  } finally {
    await source.end().catch(() => undefined);
    await target.end().catch(() => undefined);
  }
}

main().catch((error) => {
  writeMetrics({
    gymsoins_restore_last_failure_timestamp_seconds: Date.now() / 1_000,
  });
  process.stderr.write(
    `${JSON.stringify({
      event: 'restore.verify.failed',
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    })}\n`,
  );
  process.exit(1);
});
