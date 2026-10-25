-- Module Gym : abonnements, passages au tourniquet et cours collectifs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_type_enum') THEN
        CREATE TYPE subscription_type_enum AS ENUM (
            'PASS_JOURNALIER',
            'MENSUEL',
            'ANNUEL',
            'CARNET_SEANCES'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_status_enum') THEN
        CREATE TYPE subscription_status_enum AS ENUM (
            'ACTIF',
            'SUSPENDU',
            'EXPIRE'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'access_direction_enum') THEN
        CREATE TYPE access_direction_enum AS ENUM ('ENTREE', 'SORTIE');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'access_method_enum') THEN
        CREATE TYPE access_method_enum AS ENUM (
            'RFID',
            'QR_CODE',
            'BIOMETRIE',
            'MANUEL'
        );
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "clientId" VARCHAR(64) NOT NULL,
    type subscription_type_enum NOT NULL,
    status subscription_status_enum NOT NULL DEFAULT 'ACTIF',
    "startDate" TIMESTAMP WITH TIME ZONE NOT NULL,
    "endDate" TIMESTAMP WITH TIME ZONE NOT NULL,
    "remainingSessions" INTEGER NOT NULL DEFAULT 0 CHECK ("remainingSessions" >= 0),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_subscriptions_dates CHECK ("endDate" >= "startDate")
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_client ON subscriptions("clientId");
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

CREATE TABLE IF NOT EXISTS access_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "clientId" VARCHAR(64) NOT NULL,
    direction access_direction_enum NOT NULL,
    "timestamp" TIMESTAMP WITH TIME ZONE NOT NULL,
    method access_method_enum NOT NULL,
    granted BOOLEAN NOT NULL DEFAULT FALSE,
    reason TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_access_logs_client ON access_logs("clientId", "timestamp" DESC);
CREATE INDEX IF NOT EXISTS idx_access_logs_timestamp ON access_logs("timestamp" DESC);

CREATE TABLE IF NOT EXISTS group_classes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    "coachId" VARCHAR(64) NOT NULL,
    "startTime" TIMESTAMP WITH TIME ZONE NOT NULL,
    "endTime" TIMESTAMP WITH TIME ZONE NOT NULL,
    "maxCapacity" INTEGER NOT NULL DEFAULT 0 CHECK ("maxCapacity" >= 0),
    "currentBookingsCount" INTEGER NOT NULL DEFAULT 0 CHECK ("currentBookingsCount" >= 0),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_group_classes_dates CHECK ("endTime" >= "startTime")
);

CREATE INDEX IF NOT EXISTS idx_group_classes_start ON group_classes("startTime");
CREATE INDEX IF NOT EXISTS idx_group_classes_coach ON group_classes("coachId");
