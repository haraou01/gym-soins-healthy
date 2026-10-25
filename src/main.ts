import './core/telemetry/register';
import 'reflect-metadata';

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { JsonLogger } from './core/observability';
import { shutdownTelemetry } from './core/telemetry';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(new JsonLogger());

  configureApp(app);

  app.enableShutdownHooks();

  process.once('SIGTERM', () => {
    void shutdownTelemetry();
  });
  process.once('SIGINT', () => {
    void shutdownTelemetry();
  });

  const configService = app.get(ConfigService);
  const port = parseInt(configService.get('PORT', '3000'), 10);

  await app.listen(port);
  console.log(`Application démarrée sur http://localhost:${port}`);
}

void bootstrap();
