-- Module Shop : cycle de vie produit, statut de vente et total de ligne figé.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sale_status_enum') THEN
        CREATE TYPE sale_status_enum AS ENUM ('COMPLETED', 'CANCELLED');
    END IF;
END
$$;

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE sales
    ADD COLUMN IF NOT EXISTS status sale_status_enum NOT NULL DEFAULT 'COMPLETED';

ALTER TABLE sale_items
    ADD COLUMN IF NOT EXISTS "totalPrice" NUMERIC(10, 2) NOT NULL DEFAULT 0;

-- Backfill des ventes historiques : le total de ligne devient explicite.
UPDATE sale_items
SET "totalPrice" = quantity * "unitPrice"
WHERE "totalPrice" = 0
  AND quantity * "unitPrice" > 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_sale_items_total_price_nonnegative'
    ) THEN
        ALTER TABLE sale_items
            ADD CONSTRAINT chk_sale_items_total_price_nonnegative
            CHECK ("totalPrice" >= 0);
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_products_active
    ON products("isActive")
    WHERE "isActive" = FALSE;

CREATE INDEX IF NOT EXISTS idx_sales_status
    ON sales(status);
