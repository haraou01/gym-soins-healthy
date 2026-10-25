-- Optimisation des contrôles de chevauchement du module Booking.
-- Les index sont partiels : seules les réservations CONFIRME peuvent bloquer
-- un nouveau créneau, ce qui réduit la taille des index et accélère les
-- requêtes de type :
--   startTime < :endTime AND endTime > :startTime
CREATE INDEX IF NOT EXISTS idx_bookings_resource_overlap
    ON bookings ("resourceType", "resourceId", "startTime", "endTime")
    WHERE status = 'CONFIRME';

CREATE INDEX IF NOT EXISTS idx_bookings_staff_overlap
    ON bookings ("practitionerOrCoachId", "startTime", "endTime")
    WHERE status = 'CONFIRME';
