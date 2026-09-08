/**
 * Runtime guard against network I/O inside an open database transaction.
 *
 * Failure this descends from: an external HTTP call four frames deep inside a
 * transaction held it (and the locks under it) across a network round-trip.
 * AST checkers cannot see across frames; this guard can.
 *
 * Behaviour is asymmetric by design: every environment except `prod` throws
 * `NetworkIoGuardViolation` so the bug surfaces locally, in tests, and in
 * staging; prod logs a warning with the stack so a latent path is visible
 * without breaking the request.
 *
 * `installFetchGuard()` wraps the global `fetch` (app/utils/db.ts installs it).
 * Any other outbound client must call `guardNetworkIo()` before each request.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import { settings } from '../config.js';
import { getLogger } from '../observability/index.js';

const log = getLogger('app.utils.network-guard');
const activeTransactions = new AsyncLocalStorage<number>();

export class NetworkIoGuardViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkIoGuardViolation';
  }
}

/** Number of open transactions on the current async task. */
export function transactionDepth(): number {
  return activeTransactions.getStore() ?? 0;
}

/** Run `fn` with one more open transaction on the current task (used by `withTransaction`). */
export function trackTransaction<T>(fn: () => Promise<T>): Promise<T> {
  return activeTransactions.run(transactionDepth() + 1, fn);
}

/** Call before issuing any network request; throws or warns if a transaction is open. */
export function guardNetworkIo(description: string): void {
  if (transactionDepth() === 0) {
    return;
  }
  const message = `network I/O (${description}) attempted inside an open database transaction`;
  if (settings.isProd) {
    log.warn({ stack: new Error(message).stack }, message);
    return;
  }
  throw new NetworkIoGuardViolation(message);
}

type FetchInput = string | URL | Request;

function describeRequest(input: FetchInput, init: RequestInit | undefined): string {
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return `${method} ${url}`;
}

/** Wrap a fetch implementation so every call passes through the guard. */
export function guardedFetch(fetchImpl: typeof fetch): typeof fetch {
  return async (input, init) => {
    guardNetworkIo(describeRequest(input, init));
    return fetchImpl(input, init);
  };
}

const INSTALLED = Symbol.for('app-harness.fetch-guard');

/** Replace the global fetch with a guarded one (idempotent). */
export function installFetchGuard(): void {
  const target = globalThis as typeof globalThis & { [INSTALLED]?: boolean };
  if (target[INSTALLED] === true) {
    return;
  }
  target.fetch = guardedFetch(globalThis.fetch);
  target[INSTALLED] = true;
}
