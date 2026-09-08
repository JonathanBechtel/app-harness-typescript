/**
 * Correlation context: the identity of the request or job run producing a log line.
 *
 * Two questions must always be answerable: "show me every log line from the
 * request that 500'd" and "show me every log line from last night's failed job".
 * Both need an identifier bound once at the edge and carried through every
 * `await` underneath it, which is what `AsyncLocalStorage` provides.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export const FIELD_REQUEST_ID = 'request_id';
export const FIELD_RUN_ID = 'run_id';
export const FIELD_JOB = 'job';
export const FIELD_OUTCOME = 'outcome';
export const FIELD_DURATION_MS = 'duration_ms';
export const OUTCOME_SUCCEEDED = 'succeeded';
export const OUTCOME_FAILED = 'failed';

export type ContextFields = Readonly<Record<string, unknown>>;

// Inbound correlation IDs come from outside (a proxy, a client retry) and end up
// in log output, so they are constrained rather than trusted.
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const EMPTY: ContextFields = Object.freeze({});
const store = new AsyncLocalStorage<ContextFields>();

/** Return a fresh correlation id (32 hex characters). */
export function newCorrelationId(): string {
  return randomUUID().replaceAll('-', '');
}

/** Return `value` if it is a safe correlation id, else `undefined`. */
export function sanitizeCorrelationId(value: string | undefined): string | undefined {
  if (value !== undefined && CORRELATION_ID_PATTERN.test(value)) {
    return value;
  }
  return undefined;
}

/** Return the fields bound for the current async task (read-only). */
export function currentContext(): ContextFields {
  return store.getStore() ?? EMPTY;
}

function merged(fields: Record<string, unknown>): ContextFields {
  const next: Record<string, unknown> = { ...currentContext() };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) {
      next[key] = value;
    }
  }
  return Object.freeze(next);
}

/** Bind `fields` onto the context for the duration of `fn` (sync or async). */
export function bind<T>(fields: Record<string, unknown>, fn: () => T): T {
  return store.run(merged(fields), fn);
}
