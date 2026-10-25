import './core/telemetry/register';
import 'reflect-metadata';

import { createServer } from 'node:http';
import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';

import { AppModule } from './app.module';
import { JsonLogger, MetricsService, writeJsonLog } from './core/observability';
import { OutboxService } from './core/outbox';
import { shutdownTelemetry } from './core/telemetry';

/**
 * Entrypoint du worker Outbox dédié.
 *
 * - démarre sans serveur HTTP métier ;
 * - traite/retry/recover les événements Outbox ;
 * - expose /health et /metrics sur un port interne ;
 * - arrêt gracieux sur SIGTERM/SIGINT.
 */
async function bootstrap(): Promise<void> {
  process.env.OUTBOX_WORKER_ENABLED = 'true';
  process.env.POSTGRES_RUNTIME_USERNAME =
    process.env.WORKER_DB_USERNAME || 'gymsoins_worker';
  process.env.POSTGRES_RUNTIME_PASSWORD =
    process.env.WORKER_DB_PASSWORD || '';

  const app: INestApplicationContext =
    await NestFactory.createApplicationContext(AppModule, {
      bufferLogs: true,
    });

  app.useLogger(new JsonLogger());

  const dataSource = app.get(DataSource);
  const outboxService = app.get(OutboxService);
  const metricsService = app.get(MetricsService);

  const host = process.env.WORKER_HEALTH_HOST || '127.0.0.1';
  const port = Number(process.env.WORKER_HEALTH_PORT || 3002);
  const startedAt = Date.now();

  const server = createServer(async (request, response) => {
    try {
      if (request.url === '/health' || request.url === '/ready') {
        await dataSource.query('SELECT 1');
        const outbox = await outboxService.getStats();

        response.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        response.end(
          JSON.stringify({
            status: 'ok',
            role: 'outbox-worker',
            uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
            outbox,
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

  writeJsonLog('info', 'worker.started', 'OutboxWorker', {
    host,
    port,
    role: 'outbox-worker',
  });

  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    writeJsonLog('info', 'worker.shutdown', 'OutboxWorker', { signal });

    const forceExit = setTimeout(() => {
      writeJsonLog('error', 'worker.shutdown_timeout', 'OutboxWorker');
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
  writeJsonLog('error', 'worker.fatal', 'OutboxWorker', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});
