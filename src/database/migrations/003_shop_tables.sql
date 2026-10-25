-- Module Shop : catalogue produits, ventes POS et lignes de vente
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'product_category_enum') THEN
        CREATE TYPE product_category_enum AS ENUM (
            'COMPLEMENT',
            'ACCESSOIRE',
            'BOISSON',
            'AUTRE'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_method_enum') THEN
        CREATE TYPE payment_method_enum AS ENUM (
            'ESPECES',
            'CARTE',
            'POINTS_FIDELITE'
        );
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(150) NOT NULL,
    sku VARCHAR(64) NOT NULL,
    description VARCHAR(500),
    price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
    "stockQuantity" INTEGER NOT NULL DEFAULT 0 CHECK ("stockQuantity" >= 0),
    category product_category_enum NOT NULL,
    "isService" BOOLEAN NOT NULL DEFAULT FALSE,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);

CREATE TABLE IF NOT EXISTS sales (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "clientId" VARCHAR(64),
    "totalAmount" NUMERIC(10, 2) NOT NULL CHECK ("totalAmount" >= 0),
    "paymentMethod" payment_method_enum NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sales_client ON sales("clientId");
CREATE INDEX IF NOT EXISTS idx_sales_created ON sales("createdAt" DESC);

CREATE TABLE IF NOT EXISTS sale_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "saleId" UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    "productId" UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    "unitPrice" NUMERIC(10, 2) NOT NULL CHECK ("unitPrice" >= 0)
);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items("saleId");
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items("productId");
