import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import {
  resourceFromAttributes,
} from '@opentelemetry/resources';
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

import { writeJsonLog } from '../observability/json-logger';

let sdk: NodeSDK | null = null;
let started = false;

function parseFlag(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function tracesEndpoint(): string {
  const direct = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim();
  if (direct) {
    return direct;
  }

  const base = (
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
    'http://127.0.0.1:4318'
  ).replace(/\/$/, '');

  return base.endsWith('/v1/traces') ? base : `${base}/v1/traces`;
}

/**
 * Démarre le SDK OpenTelemetry uniquement si OTEL_ENABLED=true.
 *
 * Important : cet appel doit être exécuté avant le chargement des modules
 * instrumentés (http, express, pg, Nest). `register.ts` est importé en tête
 * des entrypoints.
 */
export function startTelemetry(): boolean {
  if (started) {
    return sdk !== null;
  }

  started = true;

  if (!parseFlag(process.env.OTEL_ENABLED, false)) {
    return false;
  }

  try {
    const serviceName =
      process.env.OTEL_SERVICE_NAME?.trim() || 'gymsoins-healthy';
    const endpoint = tracesEndpoint();

    sdk = new NodeSDK({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: serviceName,
        [ATTR_SERVICE_VERSION]: process.env.npm_package_version || '1.0.0',
        [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]:
          process.env.NODE_ENV || 'development',
      }),
      traceExporter: new OTLPTraceExporter({
        url: endpoint,
        timeoutMillis: Number(
          process.env.OTEL_EXPORTER_OTLP_TIMEOUT_MS || 10_000,
        ),
      }),
      instrumentations: [
        new HttpInstrumentation({
          ignoreIncomingRequestHook: (request) =>
            request.url === '/metrics' || request.url === '/health',
        }),
        new ExpressInstrumentation(),
        new PgInstrumentation({
          enhancedDatabaseReporting: false,
        }),
        new NestInstrumentation(),
      ],
    });

    sdk.start();

    writeJsonLog('info', 'otel.started', 'Telemetry', {
      serviceName,
      endpoint,
      exporter: 'otlp-http',
    });

    return true;
  } catch (error) {
    sdk = null;
    writeJsonLog('warn', 'otel.start_failed', 'Telemetry', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Un collecteur absent ou mal configuré ne doit jamais empêcher l'app.
    return false;
  }
}

export async function shutdownTelemetry(): Promise<void> {
  if (!sdk) {
    return;
  }

  try {
    await sdk.shutdown();
    writeJsonLog('info', 'otel.stopped', 'Telemetry');
  } catch (error) {
    writeJsonLog('warn', 'otel.stop_failed', 'Telemetry', {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    sdk = null;
  }
}

export function isTelemetryEnabled(): boolean {
  return sdk !== null;
}
