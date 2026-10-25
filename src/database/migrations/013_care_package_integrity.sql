-- Module Care : traçabilité de la consommation des packs et intégrité des soldes.
-- 1. Chaque séance référence le pack effectivement consommé.
ALTER TABLE care_sessions
    ADD COLUMN IF NOT EXISTS "packageId" UUID
        REFERENCES client_care_packages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_care_sessions_package
    ON care_sessions("packageId");

-- 2. Index partiel pour la sélection FIFO des packs utilisables
--    (client + soin + statut actif + solde positif).
CREATE INDEX IF NOT EXISTS idx_client_care_packages_usable
    ON client_care_packages("clientId", "careServiceId", "createdAt")
    WHERE status = 'ACTIF' AND "remainingSessions" > 0;

-- 3. Le solde restant ne peut jamais dépasser le total acheté.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_client_care_packages_remaining_le_total'
    ) THEN
        ALTER TABLE client_care_packages
            ADD CONSTRAINT chk_client_care_packages_remaining_le_total
            CHECK ("remainingSessions" <= "totalSessions");
    END IF;
END
$$;
