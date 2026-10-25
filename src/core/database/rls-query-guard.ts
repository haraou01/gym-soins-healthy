import { Client } from 'pg';

import { getTenantId } from '../tenant/tenant-context';

/**
 * Pont AsyncLocalStorage → PostgreSQL RLS.
 *
 * Le GUC `app.tenant_id` est TOUJOURS positionné avec set_config(..., true)
 * dans la transaction qui exécute la requête. Aucun SET de session n'est
 * utilisé, donc aucune fuite entre deux requêtes du pool.
 */

interface ClientState {
  inTransaction: boolean;
  tenantSet: boolean;
  queue: Promise<unknown>;
}

const states = new WeakMap<Client, ClientState>();

function stateFor(client: Client): ClientState {
  let state = states.get(client);

  if (!state) {
    state = {
      inTransaction: false,
      tenantSet: false,
      queue: Promise.resolve(),
    };
    states.set(client, state);
  }

  return state;
}

function enqueue<T>(client: Client, operation: () => Promise<T>): Promise<T> {
  const state = stateFor(client);
  const next = state.queue.then(operation, operation);
  // La queue ne doit jamais rester rejetée.
  state.queue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

interface NormalizedQuery {
  text: string;
  values: unknown[];
}

function normalizeQuery(
  query: string | { text: string; values?: unknown[] },
  values?: unknown[],
): NormalizedQuery {
  if (typeof query === 'string') {
    return { text: query, values: values ?? [] };
  }

  return { text: query.text, values: query.values ?? values ?? [] };
}

function commandOf(text: string): string {
  return text.trim().split(/\s+/)[0]?.toUpperCase() ?? '';
}

const originalQuery = Client.prototype.query;

let installed = false;

export function installRlsQueryGuard(): void {
  if (installed) {
    return;
  }

  installed = true;

  Client.prototype.query = function patchedQuery(
    this: Client,
    query: string | { text: string; values?: unknown[] },
    valuesOrCallback?: unknown[] | ((error: Error | null, result?: unknown) => void),
    maybeCallback?: (error: Error | null, result?: unknown) => void,
  ): unknown {
    let values: unknown[] | undefined;
    let callback = maybeCallback;

    if (typeof valuesOrCallback === 'function') {
      callback = valuesOrCallback;
    } else {
      values = valuesOrCallback;
    }

    const normalized = normalizeQuery(query, values);
    const command = commandOf(normalized.text);
    const tenantId = getTenantId();

    const operation = async (): Promise<unknown> => {
      const state = stateFor(this);

      if (command === 'BEGIN' || command === 'START') {
        const result = await originalQuery.call(
          this,
          normalized.text,
          normalized.values,
        );
        state.inTransaction = true;
        state.tenantSet = false;

        if (tenantId) {
          try {
            await originalQuery.call(
              this,
              "SELECT set_config('app.tenant_id', $1, true)",
              [tenantId],
            );
            state.tenantSet = true;
          } catch (error) {
            await originalQuery.call(this, 'ROLLBACK').catch(() => undefined);
            state.inTransaction = false;
            state.tenantSet = false;
            throw error;
          }
        }

        return result;
      }

      if (command === 'COMMIT' || command === 'ROLLBACK') {
        // ROLLBACK TO SAVEPOINT ne termine pas la transaction englobante.
        if (command === 'ROLLBACK' && /^ROLLBACK\s+TO\b/i.test(normalized.text)) {
          return originalQuery.call(this, normalized.text, normalized.values);
        }

        const result = await originalQuery.call(
          this,
          normalized.text,
          normalized.values,
        );
        state.inTransaction = false;
        state.tenantSet = false;
        return result;
      }

      if (state.inTransaction) {
        if (tenantId && !state.tenantSet) {
          await originalQuery.call(
            this,
            "SELECT set_config('app.tenant_id', $1, true)",
            [tenantId],
          );
          state.tenantSet = true;
        }

        return originalQuery.call(this, normalized.text, normalized.values);
      }

      if (!tenantId) {
        return originalQuery.call(this, normalized.text, normalized.values);
      }

      // Requête hors transaction : une transaction locale par requête.
      await originalQuery.call(this, 'BEGIN');
      state.inTransaction = true;

      try {
        await originalQuery.call(
          this,
          "SELECT set_config('app.tenant_id', $1, true)",
          [tenantId],
        );
        state.tenantSet = true;

        const result = await originalQuery.call(
          this,
          normalized.text,
          normalized.values,
        );

        await originalQuery.call(this, 'COMMIT');
        state.inTransaction = false;
        state.tenantSet = false;
        return result;
      } catch (error) {
        await originalQuery.call(this, 'ROLLBACK').catch(() => undefined);
        state.inTransaction = false;
        state.tenantSet = false;
        throw error;
      }
    };

    const promise = enqueue(this, operation);

    if (callback) {
      promise.then(
        (result) => callback(null, result),
        (error) => callback(error as Error),
      );
      return undefined;
    }

    return promise;
  } as typeof Client.prototype.query;
}

// Import side-effect : AppModule charge ce module dans tous les processus.
installRlsQueryGuard();
