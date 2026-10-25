import './core/telemetry/register';
import 'reflect-metadata';

import { createServer } from 'node:http';
import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';

import { AppModule } from './app.module';
import { JsonLogger, MetricsService, writeJsonLog } from './core/observability';
import { RetentionWorkerService } from './core/retention';
import { shutdownTelemetry } from './core/telemetry';

/**
 * Entrypoint du worker de rétention dédié.
 *
 * L'API ne doit pas exécuter la purge en production : ce processus séparé
 * assure idempotency + outbox purge, avec verrou PostgreSQL multi-instance.
 */
async function bootstrap(): Promise<void> {
  process.env.OUTBOX_WORKER_ENABLED = 'false';
  process.env.RETENTION_PURGE_ENABLED = 'true';
  process.env.POSTGRES_RUNTIME_USERNAME =
    process.env.RETENTION_DB_USERNAME || 'gymsoins_retention';
  process.env.POSTGRES_RUNTIME_PASSWORD =
    process.env.RETENTION_DB_PASSWORD || '';

  const app: INestApplicationContext =
    await NestFactory.createApplicationContext(AppModule, {
      bufferLogs: true,
    });

  app.useLogger(new JsonLogger());

  const dataSource = app.get(DataSource);
  const retentionWorker = app.get(RetentionWorkerService);
  const metricsService = app.get(MetricsService);

  const host = process.env.RETENTION_WORKER_HEALTH_HOST || '127.0.0.1';
  const port = Number(process.env.RETENTION_WORKER_HEALTH_PORT || 3003);
  const startedAt = Date.now();

  const server = createServer(async (request, response) => {
    try {
      if (request.url === '/health' || request.url === '/ready') {
        await dataSource.query('SELECT 1');
        const status = retentionWorker.getStatus();

        response.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        response.end(
          JSON.stringify({
            status: status.lastError ? 'degraded' : 'ok',
            role: 'retention-worker',
            uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
            retention: status,
          }),
        );
        return;
      }

      if (request.url === '/metrics') {
        response.writeHead(200, {
          'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
        });
        response.end(await metricsService.render());
        return;
      }

      response.writeHead(404, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'not_found' }));
    } catch (error) {
      response.writeHead(503, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });

  writeJsonLog('info', 'retention_worker.started', 'RetentionWorker', {
    host,
    port,
    role: 'retention-worker',
  });

  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    writeJsonLog('info', 'retention_worker.shutdown', 'RetentionWorker', {
      signal,
    });

    const forceExit = setTimeout(() => {
      writeJsonLog(
        'error',
        'retention_worker.shutdown_timeout',
        'RetentionWorker',
      );
      process.exit(1);
    }, 30_000);
    forceExit.unref();

    server.close();
    await app.close();
    await shutdownTelemetry();
    clearTimeout(forceExit);
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
}

bootstrap().catch((error) => {
  writeJsonLog('error', 'retention_worker.fatal', 'RetentionWorker', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});
