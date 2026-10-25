-- Module Booking : réservations transverses (cours, soins, équipements)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'booking_resource_type_enum') THEN
        CREATE TYPE booking_resource_type_enum AS ENUM (
            'GYM_CLASS',
            'CARE_SESSION',
            'EQUIPMENT'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'booking_status_enum') THEN
        CREATE TYPE booking_status_enum AS ENUM ('CONFIRME', 'ANNULE', 'TERMINE');
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS bookings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "clientId" VARCHAR(64) NOT NULL,
    "resourceType" booking_resource_type_enum NOT NULL,
    "resourceId" UUID NOT NULL,
    "practitionerOrCoachId" VARCHAR(64) NOT NULL,
    "startTime" TIMESTAMP WITH TIME ZONE NOT NULL,
    "endTime" TIMESTAMP WITH TIME ZONE NOT NULL,
    status booking_status_enum NOT NULL DEFAULT 'CONFIRME',
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_bookings_dates CHECK ("endTime" > "startTime")
);

CREATE INDEX IF NOT EXISTS idx_bookings_client ON bookings("clientId", "startTime" DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_resource ON bookings("resourceType", "resourceId");
CREATE INDEX IF NOT EXISTS idx_bookings_staff ON bookings("practitionerOrCoachId", "startTime");
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
