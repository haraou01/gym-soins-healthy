-- Idempotence transactionnelle des opérations critiques.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'idempotency_status_enum') THEN
        CREATE TYPE idempotency_status_enum AS ENUM (
            'PROCESSING',
            'COMPLETED',
            'FAILED'
        );
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS idempotency_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    scope VARCHAR(80) NOT NULL,
    "key" VARCHAR(255) NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    status idempotency_status_enum NOT NULL DEFAULT 'PROCESSING',
    response JSONB,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_idempotency_scope_key UNIQUE (scope, "key")
);

CREATE INDEX IF NOT EXISTS idx_idempotency_status_created
    ON idempotency_keys(status, "createdAt");
