-- Phase 4 — intégrité relationnelle tenant-scoped.
--
-- Objectif : empêcher qu'une ligne enfant du tenant A référence une ligne
-- parent du tenant B, même en cas d'écriture SQL directe hors services.
-- Les clés étrangères historiques restent conservées.

CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_tenant_id
    ON sales("tenantId", id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_tenant_id
    ON products("tenantId", id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dishes_tenant_id
    ON dishes("tenantId", id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ingredients_tenant_id
    ON ingredients("tenantId", id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_care_services_tenant_id
    ON care_services("tenantId", id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_care_packages_tenant_id
    ON client_care_packages("tenantId", id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_equipments_tenant_id
    ON equipments("tenantId", id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_loyalty_accounts_tenant_id
    ON loyalty_accounts("tenantId", id);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sale_items_sale_tenant') THEN
        ALTER TABLE sale_items
            ADD CONSTRAINT fk_sale_items_sale_tenant
            FOREIGN KEY ("tenantId", "saleId")
            REFERENCES sales("tenantId", id)
            ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sale_items_product_tenant') THEN
        ALTER TABLE sale_items
            ADD CONSTRAINT fk_sale_items_product_tenant
            FOREIGN KEY ("tenantId", "productId")
            REFERENCES products("tenantId", id)
            ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_dish_ingredients_dish_tenant') THEN
        ALTER TABLE dish_ingredients
            ADD CONSTRAINT fk_dish_ingredients_dish_tenant
            FOREIGN KEY ("tenantId", "dishId")
            REFERENCES dishes("tenantId", id)
            ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_dish_ingredients_ingredient_tenant') THEN
        ALTER TABLE dish_ingredients
            ADD CONSTRAINT fk_dish_ingredients_ingredient_tenant
            FOREIGN KEY ("tenantId", "ingredientId")
            REFERENCES ingredients("tenantId", id)
            ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_client_care_packages_service_tenant') THEN
        ALTER TABLE client_care_packages
            ADD CONSTRAINT fk_client_care_packages_service_tenant
            FOREIGN KEY ("tenantId", "careServiceId")
            REFERENCES care_services("tenantId", id)
            ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_care_sessions_service_tenant') THEN
        ALTER TABLE care_sessions
            ADD CONSTRAINT fk_care_sessions_service_tenant
            FOREIGN KEY ("tenantId", "careServiceId")
            REFERENCES care_services("tenantId", id)
            ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_care_sessions_package_tenant') THEN
        ALTER TABLE care_sessions
            ADD CONSTRAINT fk_care_sessions_package_tenant
            FOREIGN KEY ("tenantId", "packageId")
            REFERENCES client_care_packages("tenantId", id)
            ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_maintenance_tickets_equipment_tenant') THEN
        ALTER TABLE maintenance_tickets
            ADD CONSTRAINT fk_maintenance_tickets_equipment_tenant
            FOREIGN KEY ("tenantId", "equipmentId")
            REFERENCES equipments("tenantId", id)
            ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_loyalty_transactions_account_tenant') THEN
        ALTER TABLE loyalty_transactions
            ADD CONSTRAINT fk_loyalty_transactions_account_tenant
            FOREIGN KEY ("tenantId", "loyaltyAccountId")
            REFERENCES loyalty_accounts("tenantId", id)
            ON DELETE CASCADE;
    END IF;
END
$$;
