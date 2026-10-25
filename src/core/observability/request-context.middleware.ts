import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

import { writeJsonLog } from './json-logger';
import { metrics } from './metrics.registry';

const REQUEST_ID_HEADER = 'x-request-id';
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

interface AuthenticatedRequest extends Request {
  user?: { id?: string; role?: string };
  requestId?: string;
}

/**
 * Corrélation, logs d'accès structurés et métriques HTTP.
 */
export function requestContextMiddleware(
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
): void {
  const incoming = request.headers[REQUEST_ID_HEADER];
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
  const requestId =
    candidate && REQUEST_ID_PATTERN.test(candidate)
      ? candidate
      : randomUUID();

  request.requestId = requestId;
  response.setHeader('X-Request-Id', requestId);

  const startedAt = process.hrtime.bigint();
  let logged = false;

  const finish = () => {
    if (logged) {
      return;
    }
    logged = true;

    const durationMs =
      Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const route = request.route?.path
      ? `${request.baseUrl}${request.route.path}`
      : 'unmatched';
    const statusCode = response.statusCode;
    const method = request.method;

    metrics.inc('http_requests_total', {
      method,
      route,
      status: String(statusCode),
    });
    metrics.observe('http_request_duration_ms', durationMs, {
      method,
      route,
    });

    if (statusCode >= 400) {
      metrics.inc('http_errors_total', {
        type: statusCode >= 500 ? 'server' : 'client',
        route,
      });
    }

    writeJsonLog('info', 'http.request', 'HTTP', {
      requestId,
      method,
      path: request.originalUrl,
      route,
      statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      userId: request.user?.id ?? null,
      role: request.user?.role ?? null,
      tenantId: null,
      ip: request.ip ?? null,
    });
  };

  response.on('finish', finish);
  response.on('close', finish);

  next();
}
