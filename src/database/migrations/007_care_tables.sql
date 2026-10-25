-- Module Care : prestations de soin, packs clients et séances
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'care_service_type_enum') THEN
        CREATE TYPE care_service_type_enum AS ENUM ('UNITAIRE', 'PACK');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'client_care_package_status_enum') THEN
        CREATE TYPE client_care_package_status_enum AS ENUM (
            'ACTIF',
            'EPUISE',
            'EXPIRE'
        );
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS care_services (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    "durationMinutes" INTEGER NOT NULL CHECK ("durationMinutes" > 0),
    price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
    type care_service_type_enum NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_care_services_type ON care_services(type);

CREATE TABLE IF NOT EXISTS client_care_packages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "clientId" VARCHAR(64) NOT NULL,
    "careServiceId" UUID NOT NULL REFERENCES care_services(id) ON DELETE RESTRICT,
    "totalSessions" INTEGER NOT NULL CHECK ("totalSessions" > 0),
    "remainingSessions" INTEGER NOT NULL CHECK ("remainingSessions" >= 0),
    status client_care_package_status_enum NOT NULL DEFAULT 'ACTIF',
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_client_care_packages_client ON client_care_packages("clientId");
CREATE INDEX IF NOT EXISTS idx_client_care_packages_status ON client_care_packages(status);

CREATE TABLE IF NOT EXISTS care_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "clientId" VARCHAR(64) NOT NULL,
    "careServiceId" UUID NOT NULL REFERENCES care_services(id) ON DELETE RESTRICT,
    "therapistId" VARCHAR(64) NOT NULL,
    "timestamp" TIMESTAMP WITH TIME ZONE NOT NULL,
    notes TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_care_sessions_client ON care_sessions("clientId", "timestamp" DESC);
CREATE INDEX IF NOT EXISTS idx_care_sessions_therapist ON care_sessions("therapistId", "timestamp" DESC);
