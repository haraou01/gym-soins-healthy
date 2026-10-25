/**
 * Configuration d'environnement des processus workers.
 *
 * Ces fonctions sont séparées des entrypoints pour être testables sans base
 * de données et pour rendre explicite la désactivation du polling KDS.
 */
export function configureOutboxWorkerEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): void {
  env.OUTBOX_WORKER_ENABLED = 'true';
  env.KDS_EVENTS_ENABLED = 'false';
  env.POSTGRES_RUNTIME_USERNAME =
    env.WORKER_DB_USERNAME || 'gymsoins_worker';
  env.POSTGRES_RUNTIME_PASSWORD = env.WORKER_DB_PASSWORD || '';
}

export function configureRetentionWorkerEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): void {
  env.OUTBOX_WORKER_ENABLED = 'false';
  env.KDS_EVENTS_ENABLED = 'false';
  env.RETENTION_PURGE_ENABLED = 'true';
  env.POSTGRES_RUNTIME_USERNAME =
    env.RETENTION_DB_USERNAME || 'gymsoins_retention';
  env.POSTGRES_RUNTIME_PASSWORD = env.RETENTION_DB_PASSWORD || '';
}
