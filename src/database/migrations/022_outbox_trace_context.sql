-- Corrélation trace API → événement Outbox → worker.
ALTER TABLE outbox_events
    ADD COLUMN IF NOT EXISTS "traceId" VARCHAR(32),
    ADD COLUMN IF NOT EXISTS "spanId" VARCHAR(16);

CREATE INDEX IF NOT EXISTS idx_outbox_trace
    ON outbox_events("traceId")
    WHERE "traceId" IS NOT NULL;
