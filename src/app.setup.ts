import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { json, urlencoded } from 'express';
import helmet from 'helmet';

import { AllExceptionsFilter } from './core/observability/all-exceptions.filter';
import { requestContextMiddleware } from './core/observability/request-context.middleware';

/**
 * Configuration HTTP/sécurité commune à l'application et aux tests E2E.
 */
export function configureApp(app: INestApplication): void {
  const configService = app.get(ConfigService);

  const rawOrigins = configService.get<string>('CORS_ORIGINS');
  const allowedOrigins = (
    rawOrigins ??
    'http://localhost:5173,tauri://localhost,http://tauri.localhost'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  const bodyLimit = configService.get<string>('REQUEST_BODY_LIMIT') || '1mb';
  const trustProxy = configService.get<boolean | string>('TRUST_PROXY') === true
    || configService.get<string>('TRUST_PROXY') === 'true';

  app.use(
    requestContextMiddleware,
  );
  app.use(
    helmet({
      contentSecurityPolicy: false,
    }),
  );
  app.use(json({ limit: bodyLimit }));
  app.use(urlencoded({ extended: true, limit: bodyLimit }));

  const httpAdapter = app.getHttpAdapter().getInstance();

  if (typeof httpAdapter.disable === 'function') {
    httpAdapter.disable('x-powered-by');
  }

  if (trustProxy && typeof httpAdapter.set === 'function') {
    httpAdapter.set('trust proxy', 1);
  }

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Idempotency-Key',
      'x-license-key',
      'x-hardware-id',
      'x-request-id',
    ],
    exposedHeaders: [
      'X-Request-Id',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      'Retry-After',
    ],
    maxAge: 86_400,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());
}
