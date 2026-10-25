-- Module Maintenance : cycles préventifs calendaires et basés sur l'usage.
ALTER TABLE equipments
    ADD COLUMN IF NOT EXISTS "preventiveIntervalDays" INTEGER,
    ADD COLUMN IF NOT EXISTS "preventiveUsageThreshold" INTEGER,
    ADD COLUMN IF NOT EXISTS "preventiveRunningHoursThreshold" INTEGER,
    ADD COLUMN IF NOT EXISTS "lastPreventiveAt" TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS "nextPreventiveAt" TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS "usageAtLastPreventive" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "runningHoursAtLastPreventive" INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_equipments_preventive_interval'
    ) THEN
        ALTER TABLE equipments
            ADD CONSTRAINT chk_equipments_preventive_interval
            CHECK ("preventiveIntervalDays" IS NULL OR "preventiveIntervalDays" > 0);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_equipments_preventive_usage_threshold'
    ) THEN
        ALTER TABLE equipments
            ADD CONSTRAINT chk_equipments_preventive_usage_threshold
            CHECK ("preventiveUsageThreshold" IS NULL OR "preventiveUsageThreshold" > 0);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_equipments_preventive_hours_threshold'
    ) THEN
        ALTER TABLE equipments
            ADD CONSTRAINT chk_equipments_preventive_hours_threshold
            CHECK ("preventiveRunningHoursThreshold" IS NULL OR "preventiveRunningHoursThreshold" > 0);
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_equipments_next_preventive
    ON equipments("nextPreventiveAt")
    WHERE "nextPreventiveAt" IS NOT NULL;

-- Un seul ticket préventif ouvert par équipement : protège aussi contre
-- deux planifications concurrentes du même cycle.
CREATE UNIQUE INDEX IF NOT EXISTS uq_maintenance_tickets_open_preventive
    ON maintenance_tickets("equipmentId")
    WHERE type = 'PREVENTIF' AND status <> 'RESOLU';

CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_equipment_status
    ON maintenance_tickets("equipmentId", status);
