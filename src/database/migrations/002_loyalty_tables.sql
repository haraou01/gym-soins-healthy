-- Module Loyalty : comptes de fidélité et mouvements de points
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS loyalty_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "clientId" VARCHAR(255) UNIQUE NOT NULL,
    "clientEmail" VARCHAR(255),
    "pointsBalance" INTEGER NOT NULL DEFAULT 0 CHECK ("pointsBalance" >= 0),
    "totalEarned" INTEGER NOT NULL DEFAULT 0 CHECK ("totalEarned" >= 0),
    "totalSpent" INTEGER NOT NULL DEFAULT 0 CHECK ("totalSpent" >= 0),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_loyalty_accounts_client ON loyalty_accounts("clientId");
CREATE INDEX IF NOT EXISTS idx_loyalty_accounts_email ON loyalty_accounts("clientEmail");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'loyalty_transactions_type_enum') THEN
        CREATE TYPE loyalty_transactions_type_enum AS ENUM (
            'GAIN_ACHAT',
            'GAIN_CHECKIN',
            'RECOMPENSE_UTILISEE'
        );
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS loyalty_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "loyaltyAccountId" UUID NOT NULL REFERENCES loyalty_accounts(id) ON DELETE CASCADE,
    points INTEGER NOT NULL CHECK (points <> 0),
    type loyalty_transactions_type_enum NOT NULL,
    description VARCHAR(255),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_loyalty_transactions_account ON loyalty_transactions("loyaltyAccountId");
CREATE INDEX IF NOT EXISTS idx_loyalty_transactions_created ON loyalty_transactions("createdAt" DESC);
