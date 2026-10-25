-- Correctif de casse : l'ancienne contrainte historique contient des
-- majuscules dans son nom. PostgreSQL la traite comme un identifiant
-- case-sensitive lorsqu'elle est créée par TypeORM/ancien schéma.
ALTER TABLE loyalty_accounts
    DROP CONSTRAINT IF EXISTS "loyalty_accounts_clientId_key";

CREATE UNIQUE INDEX IF NOT EXISTS uq_loyalty_accounts_tenant_client
    ON loyalty_accounts("tenantId", "clientId");
