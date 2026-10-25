import type { LoggerService } from '@nestjs/common';

import { getTraceContext } from '../tracing';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'verbose';

function enabled(): boolean {
  return process.env.OBSERVABILITY_LOG_ENABLED !== 'false';
}

export function writeJsonLog(
  level: LogLevel,
  event: string,
  context: string | undefined,
  data: Record<string, unknown> = {},
): void {
  if (!enabled()) {
    return;
  }

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    context: context ?? null,
    traceId: getTraceContext()?.traceId ?? null,
    spanId: getTraceContext()?.spanId ?? null,
    ...data,
  };

  const line = `${JSON.stringify(entry)}\n`;

  if (level === 'error') {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
}

/**
 * Logger NestJS structuré JSON, sans plateforme externe.
 */
export class JsonLogger implements LoggerService {
  log(message: unknown, context?: string): void {
    this.write('info', 'log', message, context);
  }

  error(message: unknown, stack?: string, context?: string): void {
    this.write('error', 'error', message, context, {
      stack: stack ?? undefined,
    });
  }

  warn(message: unknown, context?: string): void {
    this.write('warn', 'warn', message, context);
  }

  debug(message: unknown, context?: string): void {
    this.write('debug', 'debug', message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.write('verbose', 'verbose', message, context);
  }

  private write(
    level: LogLevel,
    event: string,
    message: unknown,
    context?: string,
    extra: Record<string, unknown> = {},
  ): void {
    const normalized =
      typeof message === 'string'
        ? { message }
        : message && typeof message === 'object'
          ? { message: String((message as { message?: unknown }).message ?? JSON.stringify(message)) }
          : { message: String(message) };

    writeJsonLog(level, event, context, { ...normalized, ...extra });
  }
}
