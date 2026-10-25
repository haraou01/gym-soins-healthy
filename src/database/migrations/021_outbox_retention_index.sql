-- Index de rétention : seuls les événements Outbox PROCESSED sont purgés.
CREATE INDEX IF NOT EXISTS idx_outbox_processed_retention
    ON outbox_events("processedAt")
    WHERE status = 'PROCESSED';
