import 'reflect-metadata';

import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  );

  /**
   * Client web (Vite :5173) et shell Tauri (origine tauri://localhost) appellent
   * l'API sur un autre port : CORS doit refléter l'origine appelante.
   * Les en-têtes personnalisés de licence (x-license-key / x-hardware-id) sont
   * autorisés via le préflight par défaut.
   */
  app.enableCors({
    origin: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  });

  app.enableShutdownHooks();

  const configService = app.get(ConfigService);
  const port = parseInt(configService.get('PORT', '3000'), 10);

  await app.listen(port);
  console.log(`Application démarrée sur http://localhost:${port}`);
}

void bootstrap();
