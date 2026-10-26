import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(__dirname, '..', 'scripts', 'restore-runtime-grants.sql'),
  'utf8',
);

const verifyRestore = require('../scripts/verify-restore') as {
  EXPECTED_RUNTIME_USER: string;
  RUNTIME_TABLE_PRIVILEGES: Array<{
    table: string;
    privileges: string[];
  }>;
  RUNTIME_FUNCTION_PRIVILEGES: Array<{
    name: string;
    args: string;
  }>;
  RUNTIME_FUNCTIONAL_QUERIES: Array<{
    name: string;
    sql: string;
  }>;
};

const SMOKE_TABLES = [
  'security_audit_logs',
  'users',
  'roles',
  'tenant_memberships',
  'tenants',
  'products',
  'dishes',
  'dish_ingredients',
  'ingredients',
  'equipments',
  'outbox_events',
];

const RUNTIME_FUNCTIONS = [
  'consume_kds_stream_ticket',
  'list_kds_outbox_events',
  'outbox_stats_global',
  'purge_idempotency_batch',
  'purge_outbox_batch',
];

describe('restore-runtime-grants.sql', () => {
  it('refuse toute base autre que gymsoins_restore_check', () => {
    expect(sql).toMatch(
      /current_database\(\)\s*<>\s*'gymsoins_restore_check'/,
    );
  });

  it('rétablit CONNECT et USAGE pour gymsoins_app', () => {
    expect(sql).toMatch(
      /GRANT CONNECT ON DATABASE gymsoins_restore_check TO gymsoins_app;/,
    );
    expect(sql).toMatch(
      /GRANT USAGE ON SCHEMA public TO gymsoins_app;/,
    );
  });

  it('rétablit les droits SELECT et INSERT sur security_audit_logs', () => {
    expect(sql).toMatch(
      /GRANT SELECT, INSERT, UPDATE, DELETE[\s\S]*security_audit_logs[\s\S]*TO gymsoins_app;/,
    );
  });

  it('rétablit les droits runtime sur toutes les tables attendues', () => {
    for (const { table } of verifyRestore.RUNTIME_TABLE_PRIVILEGES) {
      expect(sql).toContain(table);
    }
  });

  it('rétablit EXECUTE sur les fonctions runtime attendues', () => {
    for (const name of RUNTIME_FUNCTIONS) {
      expect(sql).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION ${name}\\(`),
      );
    }
  });

  it('interdit explicitement schema_migrations au runtime', () => {
    expect(sql).toMatch(
      /REVOKE ALL ON schema_migrations FROM gymsoins_app;/,
    );
    expect(sql).not.toMatch(/^\s*GRANT\b[^;]*schema_migrations/im);
  });

  it('ne modifie aucun rôle global et n’accorde aucun attribut', () => {
    expect(sql).not.toMatch(/\bSUPERUSER\b/i);
    expect(sql).not.toMatch(/\bBYPASSRLS\b/i);
    expect(sql).not.toMatch(/\bCREATEDB\b/i);
    expect(sql).not.toMatch(/\bCREATEROLE\b/i);
    expect(sql).not.toMatch(/\bCREATE\s+ROLE\b/i);
    expect(sql).not.toMatch(/\bALTER\s+ROLE\b/i);
  });

  it('n’accorde ni GRANT ALL ni privilège de séquence', () => {
    expect(sql).not.toMatch(/\bGRANT\s+ALL\b/i);
    expect(sql).not.toMatch(/\bSEQUENCE\b/i);
  });

  it('limite les grants au rôle gymsoins_app', () => {
    expect(sql).not.toMatch(/\bTO\s+PUBLIC\b/i);
    expect(sql).not.toMatch(/\bTO\s+gymsoins_worker\b/i);
    expect(sql).not.toMatch(/\bTO\s+gymsoins_retention\b/i);
  });

  it('ne détruit aucun objet', () => {
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
  });
});

describe('verify-restore runtime checks', () => {
  it('cible exactement gymsoins_app', () => {
    expect(verifyRestore.EXPECTED_RUNTIME_USER).toBe('gymsoins_app');
  });

  it('couvre les tables consultées par le smoke test', () => {
    for (const table of SMOKE_TABLES) {
      expect(
        verifyRestore.RUNTIME_TABLE_PRIVILEGES.some(
          (entry) => entry.table === table,
        ),
      ).toBe(true);
    }
  });

  it('exige SELECT et INSERT sur security_audit_logs', () => {
    const audit = verifyRestore.RUNTIME_TABLE_PRIVILEGES.find(
      (entry) => entry.table === 'security_audit_logs',
    );

    expect(audit).toBeDefined();
    expect(audit?.privileges).toEqual(
      expect.arrayContaining(['SELECT', 'INSERT']),
    );
  });

  it('vérifie les fonctions runtime prévues par les migrations', () => {
    expect(
      verifyRestore.RUNTIME_FUNCTION_PRIVILEGES.map((entry) => entry.name),
    ).toEqual(expect.arrayContaining(RUNTIME_FUNCTIONS));
  });

  it('ne considère pas schema_migrations comme une table runtime', () => {
    expect(
      verifyRestore.RUNTIME_TABLE_PRIVILEGES.some(
        (entry) => entry.table === 'schema_migrations',
      ),
    ).toBe(false);
  });

  it('effectue des contrôles fonctionnels en plus des ACL', () => {
    expect(verifyRestore.RUNTIME_FUNCTIONAL_QUERIES.length).toBeGreaterThan(0);
  });
});
