require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const {
  validateVerifyRestoreTargets,
  displayTarget,
} = require('./lib/db-target-policies');

const EXPECTED_RUNTIME_USER = 'gymsoins_app';

const RUNTIME_GLOBAL_READ_TABLES = [
  'roles',
  'permissions',
  'role_permissions',
  'licenses',
];

const RUNTIME_IDENTITY_TABLES = [
  'users',
  'tenants',
  'tenant_memberships',
  'settings',
  'security_audit_logs',
];

const RUNTIME_TENANT_TABLES = [
  'access_logs',
  'bookings',
  'care_services',
  'care_sessions',
  'client_care_packages',
  'dish_ingredients',
  'dishes',
  'equipments',
  'group_classes',
  'ingredients',
  'kitchen_orders',
  'loyalty_accounts',
  'loyalty_transactions',
  'maintenance_tickets',
  'products',
  'sale_items',
  'sales',
  'subscriptions',
  'idempotency_keys',
  'outbox_events',
  'kds_stream_tickets',
];

const RUNTIME_TABLE_PRIVILEGES = [
  ...RUNTIME_GLOBAL_READ_TABLES.map((table) => ({
    table,
    privileges: ['SELECT'],
  })),
  ...RUNTIME_IDENTITY_TABLES.map((table) => ({
    table,
    privileges: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  })),
  ...RUNTIME_TENANT_TABLES.map((table) => ({
    table,
    privileges: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  })),
];

const RUNTIME_FUNCTION_PRIVILEGES = [
  { name: 'consume_kds_stream_ticket', args: 'text' },
  { name: 'list_kds_outbox_events', args: 'timestamp with time zone, integer' },
  { name: 'outbox_stats_global', args: '' },
  {
    name: 'purge_idempotency_batch',
    args: 'timestamp with time zone, integer',
  },
  { name: 'purge_outbox_batch', args: 'timestamp with time zone, integer' },
];

const RUNTIME_FUNCTIONAL_QUERIES = [
  {
    name: 'security_audit_logs',
    sql: 'SELECT COUNT(*)::int AS count FROM security_audit_logs',
  },
  {
    name: 'users',
    sql: `SELECT COUNT(*)::int AS count
          FROM users u
          JOIN roles r ON r.id = u.role_id`,
  },
  {
    name: 'tenant_memberships',
    sql: `SELECT COUNT(*)::int AS count
          FROM tenant_memberships tm
          JOIN tenants t ON t.id = tm."tenantId"
          JOIN roles r ON r.id = tm."roleId"`,
  },
  {
    name: 'products',
    sql: 'SELECT COUNT(*)::int AS count FROM products',
  },
  {
    name: 'dishes',
    sql: 'SELECT COUNT(*)::int AS count FROM dishes',
  },
  {
    name: 'dish_ingredients',
    sql: 'SELECT COUNT(*)::int AS count FROM dish_ingredients',
  },
  {
    name: 'ingredients',
    sql: 'SELECT COUNT(*)::int AS count FROM ingredients',
  },
  {
    name: 'equipments',
    sql: 'SELECT COUNT(*)::int AS count FROM equipments',
  },
  {
    name: 'outbox_events',
    sql: 'SELECT COUNT(*)::int AS count FROM outbox_events',
  },
];

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

function runtimeClient() {
  const user = process.env.POSTGRES_RUNTIME_USERNAME;
  const password = process.env.POSTGRES_RUNTIME_PASSWORD;

  if (!user || !password) {
    throw new Error(
      'POSTGRES_RUNTIME_USERNAME et POSTGRES_RUNTIME_PASSWORD sont obligatoires pour vérifier les droits runtime.',
    );
  }

  return new Client({
    host: settings.host,
    port: settings.port,
    user,
    password,
    database: targetDatabase,
  });
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

async function findTenantId(source) {
  const adminMembership = await source.query(
    `SELECT tm."tenantId"
     FROM tenant_memberships tm
     JOIN users u ON u.id = tm."userId"
     WHERE u.email = $1
     ORDER BY tm."createdAt" ASC
     LIMIT 1`,
    ['admin.e2e@gymsoins.local'],
  );

  if (adminMembership.rows[0]?.tenantId) {
    return adminMembership.rows[0].tenantId;
  }

  const fallback = await source.query(
    'SELECT id FROM tenants ORDER BY "createdAt" ASC LIMIT 1',
  );

  if (fallback.rows[0]?.id) {
    return fallback.rows[0].id;
  }

  throw new Error(
    'Aucun tenant disponible pour vérifier les droits runtime RLS.',
  );
}

async function verifyRuntimePrivileges(runtime, source, mismatches) {
  const roleResult = await runtime.query('SELECT current_user AS user');
  const connectedUser = roleResult.rows[0]?.user;

  if (connectedUser !== EXPECTED_RUNTIME_USER) {
    throw new Error(
      `Rôle runtime inattendu: ${connectedUser}; attendu: ${EXPECTED_RUNTIME_USER}.`,
    );
  }

  let aclChecks = 0;

  const databaseConnect = await runtime.query(
    "SELECT has_database_privilege(current_user, current_database(), 'CONNECT') AS allowed",
  );
  aclChecks += 1;
  if (databaseConnect.rows[0]?.allowed !== true) {
    mismatches.push({
      object: `database:${targetDatabase}`,
      privilege: 'CONNECT',
      expected: 'granted',
      actual: 'missing',
    });
  }

  const schemaUsage = await runtime.query(
    "SELECT has_schema_privilege(current_user, 'public', 'USAGE') AS allowed",
  );
  aclChecks += 1;
  if (schemaUsage.rows[0]?.allowed !== true) {
    mismatches.push({
      object: 'schema:public',
      privilege: 'USAGE',
      expected: 'granted',
      actual: 'missing',
    });
  }

  for (const { table, privileges } of RUNTIME_TABLE_PRIVILEGES) {
    for (const privilege of privileges) {
      const result = await runtime.query(
        'SELECT has_table_privilege(current_user, $1, $2) AS allowed',
        [`public.${table}`, privilege],
      );
      aclChecks += 1;

      if (result.rows[0]?.allowed !== true) {
        mismatches.push({
          object: table,
          privilege,
          expected: 'granted',
          actual: 'missing',
        });
      }
    }
  }

  for (const { name, args } of RUNTIME_FUNCTION_PRIVILEGES) {
    const result = await runtime.query(
      `SELECT
         EXISTS (
           SELECT 1
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public'
             AND p.proname = $1
             AND pg_get_function_identity_arguments(p.oid) = $2
         ) AS function_exists,
         COALESCE((
           SELECT has_function_privilege(current_user, p.oid, 'EXECUTE')
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public'
             AND p.proname = $1
             AND pg_get_function_identity_arguments(p.oid) = $2
           LIMIT 1
         ), false) AS allowed`,
      [name, args],
    );
    aclChecks += 1;

    const row = result.rows[0];
    if (row?.function_exists !== true || row?.allowed !== true) {
      mismatches.push({
        object: name,
        privilege: 'EXECUTE',
        expected: 'granted',
        actual: row?.function_exists === true ? 'missing' : 'function missing',
      });
    }
  }

  const forbidden = await runtime.query(
    `SELECT privilege,
            has_table_privilege(current_user, 'public.schema_migrations', privilege) AS allowed
     FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]) AS p(privilege)`,
  );

  for (const row of forbidden.rows) {
    if (row.allowed === true) {
      mismatches.push({
        object: 'schema_migrations',
        privilege: row.privilege,
        expected: 'not granted',
        actual: 'granted',
      });
    }
  }

  const tenantId = await findTenantId(source);
  let functionalChecks = 0;

  await runtime.query('BEGIN');
  try {
    await runtime.query(
      "SELECT set_config('app.tenant_id', $1, true)",
      [tenantId],
    );

    for (const check of RUNTIME_FUNCTIONAL_QUERIES) {
      await runtime.query(check.sql);
      functionalChecks += 1;
    }

    await runtime.query(
      `INSERT INTO security_audit_logs (action, email, success)
       VALUES ('LOGIN', 'restore-verify@gymsoins.local', true)`,
    );
    functionalChecks += 1;

    await runtime.query('SELECT * FROM outbox_stats_global()');
    functionalChecks += 1;

    await runtime.query('ROLLBACK');
  } catch (error) {
    await runtime.query('ROLLBACK').catch(() => undefined);
    mismatches.push({
      object: 'runtime-functional',
      privilege: 'execute',
      expected: 'success',
      actual: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    user: connectedUser,
    aclChecks,
    functionalChecks,
  };
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
  let runtime;

  try {
    await source.connect();
    await target.connect();
    runtime = runtimeClient();
    await runtime.connect();

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

    const runtimeSummary = await verifyRuntimePrivileges(
      runtime,
      source,
      mismatches,
    );

    process.stdout.write(
      `${JSON.stringify({
        event: mismatches.length === 0 ? 'restore.verified' : 'restore.invalid',
        sourceDatabase,
        targetDatabase,
        tablesChecked: sourceNames.length,
        migrations: migrations.rows[0].count,
        smoke,
        runtime: runtimeSummary,
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
    await Promise.all([
      source.end().catch(() => undefined),
      target.end().catch(() => undefined),
      runtime
        ? runtime.end().catch(() => undefined)
        : Promise.resolve(undefined),
    ]);
  }
}

if (require.main === module) {
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
}

module.exports = {
  EXPECTED_RUNTIME_USER,
  RUNTIME_GLOBAL_READ_TABLES,
  RUNTIME_IDENTITY_TABLES,
  RUNTIME_TENANT_TABLES,
  RUNTIME_TABLE_PRIVILEGES,
  RUNTIME_FUNCTION_PRIVILEGES,
  RUNTIME_FUNCTIONAL_QUERIES,
};
