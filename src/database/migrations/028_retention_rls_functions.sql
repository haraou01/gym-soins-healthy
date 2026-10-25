-- Phase 5 — purges rétention via fonctions SECURITY DEFINER contrôlées.
-- L'API runtime n'a pas de DELETE global direct sous RLS.

CREATE OR REPLACE FUNCTION purge_idempotency_batch(
    p_cutoff TIMESTAMP WITH TIME ZONE,
    p_limit INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    WITH expired AS (
        SELECT id
        FROM idempotency_keys
        WHERE status = 'COMPLETED'
          AND "createdAt" < p_cutoff
        ORDER BY "createdAt" ASC
        LIMIT GREATEST(LEAST(p_limit, 5000), 1)
        FOR UPDATE SKIP LOCKED
    )
    DELETE FROM idempotency_keys key
    USING expired
    WHERE key.id = expired.id;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END
$$;

CREATE OR REPLACE FUNCTION purge_outbox_batch(
    p_cutoff TIMESTAMP WITH TIME ZONE,
    p_limit INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    WITH expired AS (
        SELECT id
        FROM outbox_events
        WHERE status = 'PROCESSED'
          AND "processedAt" IS NOT NULL
          AND "processedAt" < p_cutoff
        ORDER BY "processedAt" ASC
        LIMIT GREATEST(LEAST(p_limit, 5000), 1)
        FOR UPDATE SKIP LOCKED
    )
    DELETE FROM outbox_events event
    USING expired
    WHERE event.id = expired.id;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END
$$;

REVOKE ALL ON FUNCTION purge_idempotency_batch(TIMESTAMPTZ, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION purge_outbox_batch(TIMESTAMPTZ, INTEGER) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION purge_idempotency_batch(TIMESTAMPTZ, INTEGER)
    TO gymsoins_app, gymsoins_retention;
GRANT EXECUTE ON FUNCTION purge_outbox_batch(TIMESTAMPTZ, INTEGER)
    TO gymsoins_app, gymsoins_retention;
