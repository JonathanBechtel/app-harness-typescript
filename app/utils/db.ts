/**
 * Database client, transaction helper, and the readiness probe.
 *
 * The readiness probe goes through the application's own pool rather than a
 * private connection: the question it answers is "can a request get a working
 * database connection right now", and a privileged side-channel probe would stay
 * green through exactly the pool-exhaustion incident it exists to detect.
 */

import { sql as sqlTag } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import { settings } from '../config.js';
import * as schema from '../models/index.js';
import { installFetchGuard, trackTransaction } from './network-guard.js';

// Must stay below settings.dbPoolTimeout so /health/db reports saturation
// rather than waiting on it.
export const READINESS_TIMEOUT_SECONDS = 5;

export type Schema = typeof schema;
/** The process-wide database (outside a transaction). */
export type Db = PostgresJsDatabase<Schema>;
/** What services and repositories accept: the database or a transaction on it. */
export type DbHandle = PgDatabase<PgQueryResultHKT, Schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface DbClient {
  readonly sql: Sql;
  readonly db: Db;
}

/** Build a driver + ORM pair for `url` (the app uses one; tests build their own). */
export function createDbClient(
  url: string,
  options: Partial<postgres.Options<Record<string, postgres.PostgresType>>> = {},
): DbClient {
  const client = postgres(url, {
    max: settings.dbPoolSize,
    connect_timeout: settings.dbPoolTimeout,
    onnotice: () => undefined,
    ...options,
  });
  return { sql: client, db: drizzle(client, { schema }) };
}

installFetchGuard();

const shared = createDbClient(settings.databaseUrl);
export const sql: Sql = shared.sql;
export const db: Db = shared.db;

/** Run `fn` in a transaction the network guard knows about. Routes and services use this. */
export function withTransaction<T>(handle: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return handle.transaction((tx) => trackTransaction(() => fn(tx)));
}

/** Close every pooled connection (shutdown). */
export async function disposeEngine(): Promise<void> {
  await sql.end({ timeout: 5 });
}

/** Outcome of one readiness probe. Never throws; a failure is a result. */
export interface ReadinessReport {
  readonly databaseOk: boolean;
  readonly latencyMs: number | null;
  readonly error: string | null;
}

class ProbeTimeout extends Error {}

/** `Name: message`, followed by the driver's underlying cause when the ORM wrapped it. */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) {
    return `Error: ${String(error)}`;
  }
  const cause = error.cause instanceof Error ? ` (cause: ${error.cause.message})` : '';
  return `${error.name}: ${error.message.split('\n')[0] ?? ''}${cause}`;
}

/** Run a bounded `SELECT 1` through the app's pool and report the result. */
export async function checkDatabaseReadiness(
  handle: DbHandle = db,
  timeoutSeconds: number = READINESS_TIMEOUT_SECONDS,
): Promise<ReadinessReport> {
  const started = performance.now();
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new ProbeTimeout());
    }, timeoutSeconds * 1000);
  });
  try {
    await Promise.race([handle.execute(sqlTag`SELECT 1`), deadline]);
  } catch (error) {
    if (error instanceof ProbeTimeout) {
      return { databaseOk: false, latencyMs: null, error: `timed out after ${timeoutSeconds}s` };
    }
    return { databaseOk: false, latencyMs: null, error: describeError(error) };
  } finally {
    clearTimeout(timer);
  }
  return {
    databaseOk: true,
    latencyMs: Math.round((performance.now() - started) * 10) / 10,
    error: null,
  };
}
