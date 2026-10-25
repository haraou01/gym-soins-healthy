import { randomUUID } from 'node:crypto';
import {
  context as otelContext,
  isSpanContextValid,
  trace as otelTrace,
} from '@opentelemetry/api';
import type { NextFunction, Request, Response } from 'express';

import {
  createTraceContext,
  formatTraceparent,
  runWithTraceContext,
} from '../tracing';
import { writeJsonLog } from './json-logger';
import { metrics } from './metrics.registry';

const REQUEST_ID_HEADER = 'x-request-id';
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

interface AuthenticatedRequest extends Request {
  user?: { id?: string; role?: string; tenantId?: string };
  requestId?: string;
  traceId?: string;
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

  const incomingTraceparent = request.headers.traceparent;
  const traceparent = Array.isArray(incomingTraceparent)
    ? incomingTraceparent[0]
    : incomingTraceparent;
  const activeSpanContext = otelTrace.getSpan(
    otelContext.active(),
  )?.spanContext();
  const traceContext =
    activeSpanContext && isSpanContextValid(activeSpanContext)
      ? {
          traceId: activeSpanContext.traceId,
          spanId: activeSpanContext.spanId,
          parentSpanId: undefined,
        }
      : createTraceContext(traceparent);

  request.traceId = traceContext.traceId;
  response.setHeader('X-Trace-Id', traceContext.traceId);
  response.setHeader('traceparent', formatTraceparent(traceContext));

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
      traceId: traceContext.traceId,
      spanId: traceContext.spanId,
      parentSpanId: traceContext.parentSpanId ?? null,
      method,
      path: request.originalUrl,
      route,
      statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      userId: request.user?.id ?? null,
      role: request.user?.role ?? null,
      tenantId: request.user?.tenantId ?? null,
      ip: request.ip ?? null,
    });
  };

  response.on('finish', finish);
  response.on('close', finish);

  runWithTraceContext(traceContext, () => next());
}
