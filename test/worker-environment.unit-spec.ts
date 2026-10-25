import {
  configureOutboxWorkerEnvironment,
  configureRetentionWorkerEnvironment,
} from '../src/core/runtime/worker-environment';

describe('configuration des workers', () => {
  it('désactive KDS dans le worker Outbox', () => {
    const env: NodeJS.ProcessEnv = {
      WORKER_DB_USERNAME: 'worker-test',
      WORKER_DB_PASSWORD: 'not-a-real-secret',
    };

    configureOutboxWorkerEnvironment(env);

    expect(env.OUTBOX_WORKER_ENABLED).toBe('true');
    expect(env.KDS_EVENTS_ENABLED).toBe('false');
    expect(env.POSTGRES_RUNTIME_USERNAME).toBe('worker-test');
  });

  it('désactive KDS dans le worker de rétention et active la purge', () => {
    const env: NodeJS.ProcessEnv = {
      RETENTION_DB_USERNAME: 'retention-test',
      RETENTION_DB_PASSWORD: 'not-a-real-secret',
    };

    configureRetentionWorkerEnvironment(env);

    expect(env.OUTBOX_WORKER_ENABLED).toBe('false');
    expect(env.KDS_EVENTS_ENABLED).toBe('false');
    expect(env.RETENTION_PURGE_ENABLED).toBe('true');
    expect(env.POSTGRES_RUNTIME_USERNAME).toBe('retention-test');
  });
});
