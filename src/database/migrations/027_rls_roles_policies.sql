-- Phase 5 — RLS PostgreSQL et rôles runtime minimaux.
--
-- Le rôle propriétaire/migration reste `gymsoins` (superuser local/CI).
-- Les rôles runtime sont créés NOLOGIN ; le bootstrap active LOGIN + mot de
-- passe depuis l'environnement. Aucun secret n'est stocké ici.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gymsoins_app') THEN
        CREATE ROLE gymsoins_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gymsoins_worker') THEN
        CREATE ROLE gymsoins_worker NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gymsoins_retention') THEN
        CREATE ROLE gymsoins_retention NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    END IF;
END
$$;

DO $$
BEGIN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO gymsoins_app, gymsoins_worker, gymsoins_retention', current_database());
END
$$;

GRANT USAGE ON SCHEMA public TO gymsoins_app, gymsoins_worker, gymsoins_retention;

-- Référentiels globaux : lecture runtime.
GRANT SELECT ON roles, permissions, role_permissions, licenses TO gymsoins_app;

-- Identité et configuration globales : accès applicatif contrôlé par services.
GRANT SELECT, INSERT, UPDATE, DELETE
    ON users, tenants, tenant_memberships, settings, security_audit_logs
    TO gymsoins_app;

-- Tables métier tenant-owned : grants DML, policies ci-dessous.
DO $$
DECLARE
    table_name TEXT;
    tables TEXT[] := ARRAY[
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
        'kds_stream_tickets'
    ];
BEGIN
    FOREACH table_name IN ARRAY tables
    LOOP
        EXECUTE format(
            'GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO gymsoins_app, gymsoins_worker',
            table_name
        );
        EXECUTE format(
            'ALTER TABLE %I ENABLE ROW LEVEL SECURITY',
            table_name
        );
        EXECUTE format(
            'ALTER TABLE %I FORCE ROW LEVEL SECURITY',
            table_name
        );

        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public'
              AND tablename = table_name
              AND policyname = 'tenant_isolation_app'
        ) THEN
            EXECUTE format(
                'CREATE POLICY tenant_isolation_app ON %I FOR ALL TO gymsoins_app USING ("tenantId" = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK ("tenantId" = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
                table_name
            );
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public'
              AND tablename = table_name
              AND policyname = 'tenant_isolation_worker'
        ) THEN
            EXECUTE format(
                'CREATE POLICY tenant_isolation_worker ON %I FOR ALL TO gymsoins_worker USING ("tenantId" = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK ("tenantId" = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
                table_name
            );
        END IF;
    END LOOP;
END
$$;

-- Le worker Outbox doit claim/recover des événements multi-tenant.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'outbox_events'
          AND policyname = 'outbox_worker_all'
    ) THEN
        CREATE POLICY outbox_worker_all ON outbox_events
            FOR ALL TO gymsoins_worker
            USING (true)
            WITH CHECK (true);
    END IF;
END
$$;

-- La rétention purge globalement des événements traités et des clés expirées.
GRANT SELECT, DELETE ON outbox_events, idempotency_keys TO gymsoins_retention;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'outbox_events'
          AND policyname = 'outbox_retention_all'
    ) THEN
        CREATE POLICY outbox_retention_all ON outbox_events
            FOR ALL TO gymsoins_retention
            USING (true)
            WITH CHECK (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'idempotency_keys'
          AND policyname = 'idempotency_retention_all'
    ) THEN
        CREATE POLICY idempotency_retention_all ON idempotency_keys
            FOR ALL TO gymsoins_retention
            USING (true)
            WITH CHECK (true);
    END IF;
END
$$;

-- Consommation d'un ticket SSE sans contexte tenant préalable.
-- Le hash opaque est la capacité ; la fonction est l'unique chemin de lecture
-- cross-tenant de cette table pour le runtime.
CREATE OR REPLACE FUNCTION consume_kds_stream_ticket(p_token_hash TEXT)
RETURNS TABLE ("userId" VARCHAR, role VARCHAR, "tenantId" UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN QUERY
    WITH candidate AS (
        SELECT id
        FROM kds_stream_tickets
        WHERE "tokenHash" = p_token_hash
          AND "usedAt" IS NULL
          AND "expiresAt" > NOW()
        FOR UPDATE SKIP LOCKED
    )
    UPDATE kds_stream_tickets ticket
    SET "usedAt" = NOW()
    FROM candidate
    WHERE ticket.id = candidate.id
    RETURNING ticket."userId", ticket.role, ticket."tenantId";
END
$$;

REVOKE ALL ON FUNCTION consume_kds_stream_ticket(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consume_kds_stream_ticket(TEXT) TO gymsoins_app;

-- Lecture Outbox KDS multi-tenant pour router les flux SSE.
CREATE OR REPLACE FUNCTION list_kds_outbox_events(
    p_cursor TIMESTAMP WITH TIME ZONE,
    p_limit INTEGER
)
RETURNS TABLE (
    id UUID,
    "tenantId" UUID,
    "eventType" VARCHAR,
    payload JSONB,
    "traceId" VARCHAR,
    "processedAt" TIMESTAMP WITH TIME ZONE
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT event.id,
           event."tenantId",
           event."eventType",
           event.payload,
           event."traceId",
           event."processedAt"
    FROM outbox_events event
    WHERE event.status = 'PROCESSED'
      AND event."eventType" IN ('kitchen.order.created', 'kitchen.order.status_changed')
      AND event."processedAt" >= p_cursor
    ORDER BY event."processedAt" ASC, event.id ASC
    LIMIT LEAST(GREATEST(p_limit, 1), 500);
$$;

REVOKE ALL ON FUNCTION list_kds_outbox_events(TIMESTAMPTZ, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_kds_outbox_events(TIMESTAMPTZ, INTEGER)
    TO gymsoins_app, gymsoins_worker;

-- Statistiques Outbox agrégées pour Prometheus, sans lecture directe globale.
CREATE OR REPLACE FUNCTION outbox_stats_global()
RETURNS TABLE (status TEXT, count BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT event.status::text, COUNT(*)::bigint
    FROM outbox_events event
    GROUP BY event.status;
$$;

REVOKE ALL ON FUNCTION outbox_stats_global() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION outbox_stats_global() TO gymsoins_app, gymsoins_worker, gymsoins_retention;

-- Aucun accès runtime à schema_migrations.
REVOKE ALL ON schema_migrations FROM gymsoins_app, gymsoins_worker, gymsoins_retention;
