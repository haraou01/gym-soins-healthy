-- Module Maintenance : enrichissement de l'inventaire et du suivi des interventions
-- 1. Informations fournisseur / garantie sur les équipements
-- 2. Typage des interventions (correctif / préventif) et données de suivi

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'maintenance_ticket_type_enum') THEN
        CREATE TYPE maintenance_ticket_type_enum AS ENUM ('CORRECTIF', 'PREVENTIF');
    END IF;
END
$$;

ALTER TABLE equipments
    ADD COLUMN IF NOT EXISTS supplier VARCHAR(200),
    ADD COLUMN IF NOT EXISTS "warrantyEndDate" DATE;

ALTER TABLE maintenance_tickets
    ADD COLUMN IF NOT EXISTS type maintenance_ticket_type_enum NOT NULL DEFAULT 'CORRECTIF',
    ADD COLUMN IF NOT EXISTS "scheduledAt" TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS technician VARCHAR(120),
    ADD COLUMN IF NOT EXISTS "partsReplaced" TEXT;

CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_scheduled
    ON maintenance_tickets("scheduledAt");
