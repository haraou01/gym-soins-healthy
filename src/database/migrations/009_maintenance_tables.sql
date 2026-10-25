-- Module Maintenance : parc d'équipements et tickets d'intervention
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'equipment_category_enum') THEN
        CREATE TYPE equipment_category_enum AS ENUM (
            'CARDIO',
            'MUSCULATION',
            'FUNCTIONAL',
            'CABINE_SOIN',
            'TOURNQUIET'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'equipment_status_enum') THEN
        CREATE TYPE equipment_status_enum AS ENUM ('ACTIF', 'EN_PANNE', 'EN_MAINTENANCE');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'maintenance_priority_enum') THEN
        CREATE TYPE maintenance_priority_enum AS ENUM ('BASSE', 'MOYENNE', 'URGENTE');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'maintenance_ticket_status_enum') THEN
        CREATE TYPE maintenance_ticket_status_enum AS ENUM ('OUVERT', 'EN_COURS', 'RESOLU');
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS equipments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(200) NOT NULL,
    "serialNumber" VARCHAR(100) NOT NULL,
    category equipment_category_enum NOT NULL,
    location VARCHAR(200) NOT NULL,
    status equipment_status_enum NOT NULL DEFAULT 'ACTIF',
    "purchaseDate" DATE,
    "usageCount" INTEGER NOT NULL DEFAULT 0 CHECK ("usageCount" >= 0),
    "runningHours" INTEGER NOT NULL DEFAULT 0 CHECK ("runningHours" >= 0),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_equipments_serial ON equipments("serialNumber");
CREATE INDEX IF NOT EXISTS idx_equipments_status ON equipments(status);

CREATE TABLE IF NOT EXISTS maintenance_tickets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "equipmentId" UUID NOT NULL REFERENCES equipments(id) ON DELETE RESTRICT,
    "reportedByUserId" VARCHAR(64) NOT NULL,
    description TEXT NOT NULL,
    priority maintenance_priority_enum NOT NULL DEFAULT 'MOYENNE',
    status maintenance_ticket_status_enum NOT NULL DEFAULT 'OUVERT',
    cost NUMERIC(10, 2) CHECK (cost >= 0),
    "resolvedAt" TIMESTAMP WITH TIME ZONE,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_equipment ON maintenance_tickets("equipmentId");
CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_status ON maintenance_tickets(status);
