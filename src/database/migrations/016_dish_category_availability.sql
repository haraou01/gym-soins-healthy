-- Module Healthy Food : catégorie et disponibilité des plats.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dish_category_enum') THEN
        CREATE TYPE dish_category_enum AS ENUM (
            'ENTREE',
            'PLAT',
            'DESSERT',
            'BOISSON',
            'SNACK',
            'AUTRE'
        );
    END IF;
END
$$;

ALTER TABLE dishes
    ADD COLUMN IF NOT EXISTS category dish_category_enum NOT NULL DEFAULT 'PLAT',
    ADD COLUMN IF NOT EXISTS "isAvailable" BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_dishes_category
    ON dishes(category);

CREATE INDEX IF NOT EXISTS idx_dishes_available
    ON dishes("isAvailable")
    WHERE "isAvailable" = TRUE;
