import 'reflect-metadata';

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { JsonLogger } from './core/observability';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(new JsonLogger());

  configureApp(app);

  app.enableShutdownHooks();

  const configService = app.get(ConfigService);
  const port = parseInt(configService.get('PORT', '3000'), 10);

  await app.listen(port);
  console.log(`Application démarrée sur http://localhost:${port}`);
}

void bootstrap();
