-- Tickets courts, opaques et à usage unique pour le flux SSE KDS.
CREATE TABLE IF NOT EXISTS kds_stream_tickets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "tokenHash" VARCHAR(64) NOT NULL UNIQUE,
    "userId" VARCHAR(64) NOT NULL,
    role VARCHAR(32) NOT NULL,
    "tenantId" VARCHAR(64) NOT NULL DEFAULT 'default',
    "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "usedAt" TIMESTAMP WITH TIME ZONE,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_kds_stream_tickets_expiry
    ON kds_stream_tickets("expiresAt")
    WHERE "usedAt" IS NULL;
