-- Restaure les ACL du rôle runtime applicatif sur la base éphémère de
-- restauration. Ce fichier ne rejoue pas la migration 027 : il ne contient que
-- les GRANT explicitement définis pour gymsoins_app par 027 et 028, ainsi que
-- le REVOKE de schema_migrations.
--
-- Le dump et le restore utilisent --no-privileges. Les migrations déjà
-- appliquées ne sont pas rejouées, donc les ACL doivent être rétablies ici.
--
-- Ce script est volontairement limité à gymsoins_restore_check. Il ne modifie
-- aucun rôle global, aucune autre base et n'accorde aucun attribut de rôle.

DO $$
BEGIN
    IF current_database() <> 'gymsoins_restore_check' THEN
        RAISE EXCEPTION
            'restore-runtime-grants.sql doit cibler gymsoins_restore_check, base courante: %',
            current_database();
    END IF;
END
$$;

-- Connexion et usage du schéma.
GRANT CONNECT ON DATABASE gymsoins_restore_check TO gymsoins_app;
GRANT USAGE ON SCHEMA public TO gymsoins_app;

-- Référentiels globaux : lecture runtime (027:32).
GRANT SELECT
    ON roles, permissions, role_permissions, licenses
    TO gymsoins_app;

-- Identité et configuration globales : accès applicatif (027:35-37).
GRANT SELECT, INSERT, UPDATE, DELETE
    ON users, tenants, tenant_memberships, settings, security_audit_logs
    TO gymsoins_app;

-- Tables métier tenant-owned : grants DML runtime (027:43-70).
GRANT SELECT, INSERT, UPDATE, DELETE
    ON access_logs, bookings, care_services, care_sessions,
       client_care_packages, dish_ingredients, dishes, equipments,
       group_classes, ingredients, kitchen_orders, loyalty_accounts,
       loyalty_transactions, maintenance_tickets, products, sale_items,
       sales, subscriptions, idempotency_keys, outbox_events,
       kds_stream_tickets
    TO gymsoins_app;

-- Fonctions runtime prévues par 027 et 028.
GRANT EXECUTE ON FUNCTION consume_kds_stream_ticket(TEXT)
    TO gymsoins_app;

GRANT EXECUTE ON FUNCTION list_kds_outbox_events(TIMESTAMPTZ, INTEGER)
    TO gymsoins_app;

GRANT EXECUTE ON FUNCTION outbox_stats_global()
    TO gymsoins_app;

GRANT EXECUTE ON FUNCTION purge_idempotency_batch(TIMESTAMPTZ, INTEGER)
    TO gymsoins_app;

GRANT EXECUTE ON FUNCTION purge_outbox_batch(TIMESTAMPTZ, INTEGER)
    TO gymsoins_app;

-- Le runtime ne doit jamais lire la table de suivi des migrations (027:238).
REVOKE ALL ON schema_migrations FROM gymsoins_app;
