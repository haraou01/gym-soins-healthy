-- Phase 5 — métriques Outbox globales accessibles aux workers.
-- Les workers exposent /metrics et doivent lire l'agrégat SECURITY DEFINER,
-- sans accès direct global à la table outbox_events.
GRANT EXECUTE ON FUNCTION outbox_stats_global()
    TO gymsoins_worker, gymsoins_retention;
