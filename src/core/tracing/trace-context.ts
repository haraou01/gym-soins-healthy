import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}

const storage = new AsyncLocalStorage<TraceContext>();
const TRACEPARENT_PATTERN =
  /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;

export function getTraceContext(): TraceContext | undefined {
  return storage.getStore();
}

export function runWithTraceContext<T>(
  context: TraceContext,
  callback: () => T,
): T {
  return storage.run(context, callback);
}

export function createTraceContext(traceparent?: string): TraceContext {
  const spanId = randomBytes(8).toString('hex');
  const match = traceparent?.match(TRACEPARENT_PATTERN);

  if (match) {
    const traceId = match[1].toLowerCase();
    const parentSpanId = match[2].toLowerCase();

    if (
      !/^0{32}$/.test(traceId) &&
      !/^0{16}$/.test(parentSpanId)
    ) {
      return { traceId, spanId, parentSpanId };
    }
  }

  return {
    traceId: randomBytes(16).toString('hex'),
    spanId,
  };
}

export function createChildTraceContext(
  parent: Pick<TraceContext, 'traceId' | 'spanId'>,
): TraceContext {
  return {
    traceId: parent.traceId,
    spanId: randomBytes(8).toString('hex'),
    parentSpanId: parent.spanId,
  };
}

export function formatTraceparent(context: TraceContext): string {
  return `00-${context.traceId}-${context.spanId}-01`;
}
