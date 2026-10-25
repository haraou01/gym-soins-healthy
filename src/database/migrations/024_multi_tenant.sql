-- Phase 4 — modèle multi-tenant strict.
--
-- Migration additive :
--   1. crée tenants + tenant_memberships ;
--   2. crée un tenant legacy déterministe pour les données historiques ;
--   3. ajoute tenantId aux tables métier, backfill legacy, puis NOT NULL + FK ;
--   4. adapte les contraintes UNIQUE et les index au tenant ;
--   5. conserve les anciennes structures (aucun DROP de colonne métier).

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tenant_status_enum') THEN
        CREATE TYPE tenant_status_enum AS ENUM ('ACTIVE', 'SUSPENDED');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tenant_membership_status_enum') THEN
        CREATE TYPE tenant_membership_status_enum AS ENUM ('ACTIVE', 'SUSPENDED');
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug VARCHAR(80) NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    status tenant_status_enum NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tenant_memberships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "tenantId" UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    "userId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "roleId" UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    status tenant_membership_status_enum NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_tenant_memberships_tenant_user UNIQUE ("tenantId", "userId")
);

CREATE INDEX IF NOT EXISTS idx_tenant_memberships_user
    ON tenant_memberships("userId");
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_tenant
    ON tenant_memberships("tenantId");

-- Tenant historique déterministe, utilisé pour backfill et tests de migration.
INSERT INTO tenants (id, slug, name, status)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'legacy',
    'Legacy tenant',
    'ACTIVE'
)
ON CONFLICT (slug) DO NOTHING;

-- Rattache les utilisateurs historiques au tenant legacy avec leur rôle existant.
INSERT INTO tenant_memberships ("tenantId", "userId", "roleId", status)
SELECT
    t.id,
    u.id,
    u.role_id,
    'ACTIVE'
FROM users u
JOIN tenants t ON t.slug = 'legacy'
WHERE u.role_id IS NOT NULL
ON CONFLICT ("tenantId", "userId") DO NOTHING;

-- Tables métier tenant-owned.
DO $$
DECLARE
    table_name TEXT;
    tenant_table TEXT;
    tables TEXT[] := ARRAY[
        'access_logs',
        'bookings',
        'care_services',
        'care_sessions',
        'client_care_packages',
        'dish_ingredients',
        'dishes',
        'equipments',
        'group_classes',
        'ingredients',
        'kitchen_orders',
        'loyalty_accounts',
        'loyalty_transactions',
        'maintenance_tickets',
        'products',
        'sale_items',
        'sales',
        'subscriptions'
    ];
BEGIN
    SELECT id INTO tenant_table FROM tenants WHERE slug = 'legacy';

    FOREACH table_name IN ARRAY tables
    LOOP
        EXECUTE format(
            'ALTER TABLE %I ADD COLUMN IF NOT EXISTS "tenantId" UUID',
            table_name
        );

        EXECUTE format(
            'UPDATE %I SET "tenantId" = $1::uuid WHERE "tenantId" IS NULL',
            table_name
        ) USING tenant_table;

        EXECUTE format(
            'ALTER TABLE %I ALTER COLUMN "tenantId" SET NOT NULL',
            table_name
        );

        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'fk_' || table_name || '_tenant'
        ) THEN
            EXECUTE format(
                'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("tenantId") REFERENCES tenants(id) ON DELETE RESTRICT',
                table_name,
                'fk_' || table_name || '_tenant'
            );
        END IF;

        EXECUTE format(
            'CREATE INDEX IF NOT EXISTS %I ON %I ("tenantId")',
            'idx_' || table_name || '_tenant',
            table_name
        );
    END LOOP;
END
$$;

-- Outbox : le tenant est une propriété de sécurité de l'événement.
ALTER TABLE outbox_events
    ADD COLUMN IF NOT EXISTS "tenantId" UUID;

UPDATE outbox_events
SET "tenantId" = (SELECT id FROM tenants WHERE slug = 'legacy')
WHERE "tenantId" IS NULL;

ALTER TABLE outbox_events
    ALTER COLUMN "tenantId" SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_outbox_events_tenant'
    ) THEN
        ALTER TABLE outbox_events
            ADD CONSTRAINT fk_outbox_events_tenant
            FOREIGN KEY ("tenantId") REFERENCES tenants(id) ON DELETE RESTRICT;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_outbox_tenant_status_available
    ON outbox_events("tenantId", status, "availableAt", "createdAt");

-- Idempotence : une clé identique reste isolée par tenant.
ALTER TABLE idempotency_keys
    ADD COLUMN IF NOT EXISTS "tenantId" UUID;

UPDATE idempotency_keys
SET "tenantId" = (SELECT id FROM tenants WHERE slug = 'legacy')
WHERE "tenantId" IS NULL;

ALTER TABLE idempotency_keys
    ALTER COLUMN "tenantId" SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_idempotency_keys_tenant'
    ) THEN
        ALTER TABLE idempotency_keys
            ADD CONSTRAINT fk_idempotency_keys_tenant
            FOREIGN KEY ("tenantId") REFERENCES tenants(id) ON DELETE RESTRICT;
    END IF;
END
$$;

ALTER TABLE idempotency_keys
    DROP CONSTRAINT IF EXISTS uq_idempotency_scope_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_idempotency_tenant_scope_key
    ON idempotency_keys("tenantId", scope, "key");

CREATE INDEX IF NOT EXISTS idx_idempotency_tenant_status_created
    ON idempotency_keys("tenantId", status, "createdAt");

-- Tickets SSE : conversion de la valeur legacy 'default' vers le tenant réel.
UPDATE kds_stream_tickets
SET "tenantId" = CASE
    WHEN "tenantId" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN "tenantId"
    ELSE (SELECT id::text FROM tenants WHERE slug = 'legacy')
END;

ALTER TABLE kds_stream_tickets
    ALTER COLUMN "tenantId" DROP DEFAULT;

ALTER TABLE kds_stream_tickets
    ALTER COLUMN "tenantId" TYPE UUID
    USING "tenantId"::uuid;

ALTER TABLE kds_stream_tickets
    ALTER COLUMN "tenantId" SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_kds_stream_tickets_tenant'
    ) THEN
        ALTER TABLE kds_stream_tickets
            ADD CONSTRAINT fk_kds_stream_tickets_tenant
            FOREIGN KEY ("tenantId") REFERENCES tenants(id) ON DELETE CASCADE;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_kds_stream_tickets_tenant_expiry
    ON kds_stream_tickets("tenantId", "expiresAt")
    WHERE "usedAt" IS NULL;

-- Audit global/auth : tenant nullable car un échec peut précéder la sélection.
ALTER TABLE security_audit_logs
    ADD COLUMN IF NOT EXISTS "tenantId" UUID;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_security_audit_logs_tenant'
    ) THEN
        ALTER TABLE security_audit_logs
            ADD CONSTRAINT fk_security_audit_logs_tenant
            FOREIGN KEY ("tenantId") REFERENCES tenants(id) ON DELETE SET NULL;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_security_audit_tenant_created
    ON security_audit_logs("tenantId", "createdAt" DESC);

-- Unicité tenant-scoped.
DROP INDEX IF EXISTS idx_products_sku;
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_tenant_sku
    ON products("tenantId", sku);

ALTER TABLE ingredients
    DROP CONSTRAINT IF EXISTS ingredients_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ingredients_tenant_name
    ON ingredients("tenantId", name);

DROP INDEX IF EXISTS idx_equipments_serial;
CREATE UNIQUE INDEX IF NOT EXISTS uq_equipments_tenant_serial
    ON equipments("tenantId", "serialNumber");

ALTER TABLE loyalty_accounts
    DROP CONSTRAINT IF EXISTS "loyalty_accounts_clientId_key";
CREATE UNIQUE INDEX IF NOT EXISTS uq_loyalty_accounts_tenant_client
    ON loyalty_accounts("tenantId", "clientId");

ALTER TABLE dish_ingredients
    DROP CONSTRAINT IF EXISTS uq_dish_ingredients_dish_ingredient;
CREATE UNIQUE INDEX IF NOT EXISTS uq_dish_ingredients_tenant_dish_ingredient
    ON dish_ingredients("tenantId", "dishId", "ingredientId");

-- Les contraintes d'exclusion Booking incluent désormais le tenant.
ALTER TABLE bookings
    DROP CONSTRAINT IF EXISTS ex_bookings_resource_overlap;
ALTER TABLE bookings
    DROP CONSTRAINT IF EXISTS ex_bookings_practitioner_overlap;

ALTER TABLE bookings
    ADD CONSTRAINT ex_bookings_resource_overlap
    EXCLUDE USING gist (
        "tenantId" WITH =,
        "resourceType" WITH =,
        "resourceId" WITH =,
        tstzrange("startTime", "endTime", '[)') WITH &&
    )
    WHERE (status = 'CONFIRME'::booking_status_enum);

ALTER TABLE bookings
    ADD CONSTRAINT ex_bookings_practitioner_overlap
    EXCLUDE USING gist (
        "tenantId" WITH =,
        "practitionerOrCoachId" WITH =,
        tstzrange("startTime", "endTime", '[)') WITH &&
    )
    WHERE (status = 'CONFIRME'::booking_status_enum);
