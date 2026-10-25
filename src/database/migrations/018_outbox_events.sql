-- Outbox transactionnelle pour les événements critiques.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'outbox_status_enum') THEN
        CREATE TYPE outbox_status_enum AS ENUM (
            'PENDING',
            'PROCESSING',
            'PROCESSED',
            'FAILED'
        );
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS outbox_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "eventType" VARCHAR(120) NOT NULL,
    "aggregateType" VARCHAR(80) NOT NULL,
    "aggregateId" VARCHAR(64) NOT NULL,
    payload JSONB NOT NULL,
    status outbox_status_enum NOT NULL DEFAULT 'PENDING',
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    "availableAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP WITH TIME ZONE,
    "lastError" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_outbox_available
    ON outbox_events(status, "availableAt", "createdAt");

CREATE INDEX IF NOT EXISTS idx_outbox_aggregate
    ON outbox_events("aggregateType", "aggregateId");

CREATE INDEX IF NOT EXISTS idx_outbox_failed
    ON outbox_events("updatedAt")
    WHERE status = 'FAILED';
