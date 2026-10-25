-- Booking : dernière ligne de défense PostgreSQL contre les doubles réservations.
CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ex_bookings_resource_overlap'
    ) THEN
        ALTER TABLE bookings
            ADD CONSTRAINT ex_bookings_resource_overlap
            EXCLUDE USING gist (
                "resourceType" WITH =,
                "resourceId" WITH =,
                tstzrange("startTime", "endTime", '[)') WITH &&
            )
            WHERE (status = 'CONFIRME');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ex_bookings_practitioner_overlap'
    ) THEN
        ALTER TABLE bookings
            ADD CONSTRAINT ex_bookings_practitioner_overlap
            EXCLUDE USING gist (
                "practitionerOrCoachId" WITH =,
                tstzrange("startTime", "endTime", '[)') WITH &&
            )
            WHERE (status = 'CONFIRME');
    END IF;
END
$$;
