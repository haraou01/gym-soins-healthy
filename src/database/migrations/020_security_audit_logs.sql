-- Journal d'audit des opérations d'authentification sensibles.
CREATE TABLE IF NOT EXISTS security_audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    action VARCHAR(64) NOT NULL,
    email VARCHAR(255),
    "userId" UUID,
    success BOOLEAN NOT NULL,
    ip VARCHAR(64),
    "userAgent" VARCHAR(500),
    metadata JSONB,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_security_audit_action_created
    ON security_audit_logs(action, "createdAt" DESC);

CREATE INDEX IF NOT EXISTS idx_security_audit_email_created
    ON security_audit_logs(email, "createdAt" DESC);
