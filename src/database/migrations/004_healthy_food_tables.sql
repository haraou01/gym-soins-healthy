-- Module Healthy Food : ingrédients, plats, recettes et commandes cuisine (KDS)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ingredient_unit_enum') THEN
        CREATE TYPE ingredient_unit_enum AS ENUM ('GRAMMES', 'UNITE', 'ML');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dish_type_enum') THEN
        CREATE TYPE dish_type_enum AS ENUM ('PRET', 'SUR_COMMANDE');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'kitchen_order_status_enum') THEN
        CREATE TYPE kitchen_order_status_enum AS ENUM (
            'EN_ATTENTE',
            'EN_PREPARATION',
            'PRET',
            'SERVI',
            'ANNULE'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'kitchen_order_type_enum') THEN
        CREATE TYPE kitchen_order_type_enum AS ENUM ('SUR_PLACE', 'A_EMPORTER');
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS ingredients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(150) NOT NULL UNIQUE,
    unit ingredient_unit_enum NOT NULL,
    "stockQuantity" NUMERIC(12, 3) NOT NULL DEFAULT 0 CHECK ("stockQuantity" >= 0),
    "alertThreshold" NUMERIC(12, 3) NOT NULL DEFAULT 0 CHECK ("alertThreshold" >= 0),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dishes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(150) NOT NULL,
    description VARCHAR(500),
    price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
    "isCustomizable" BOOLEAN NOT NULL DEFAULT FALSE,
    type dish_type_enum NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dish_ingredients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "dishId" UUID NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
    "ingredientId" UUID NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
    "quantityNeeded" NUMERIC(12, 3) NOT NULL CHECK ("quantityNeeded" > 0),
    CONSTRAINT uq_dish_ingredients_dish_ingredient UNIQUE ("dishId", "ingredientId")
);

CREATE INDEX IF NOT EXISTS idx_dish_ingredients_dish ON dish_ingredients("dishId");
CREATE INDEX IF NOT EXISTS idx_dish_ingredients_ingredient ON dish_ingredients("ingredientId");

CREATE TABLE IF NOT EXISTS kitchen_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "clientId" VARCHAR(64) NOT NULL,
    status kitchen_order_status_enum NOT NULL DEFAULT 'EN_ATTENTE',
    type kitchen_order_type_enum NOT NULL,
    items JSONB NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_kitchen_orders_client ON kitchen_orders("clientId");
CREATE INDEX IF NOT EXISTS idx_kitchen_orders_status ON kitchen_orders(status);
CREATE INDEX IF NOT EXISTS idx_kitchen_orders_created ON kitchen_orders("createdAt" DESC);
