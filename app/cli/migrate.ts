/**
 * Apply pending migrations. Runs at container start, before the server binds.
 *
 * drizzle-kit writes revisions to `app/migrations/<NNNN>_<slug>.sql` and records
 * them in `meta/_journal.json`; this runner applies them, forward-only. Two
 * lock-safety properties are load-bearing and guarded by
 * `scripts/check-migration-safety.ts`:
 *
 * - `lock_timeout` bounds lock *acquisition*: a revision that cannot get its
 *   lock fails fast and retryably instead of queueing ahead of production reads.
 * - one transaction per revision bounds lock *lifetime*: each revision commits as
 *   it finishes rather than holding every ACCESS EXCLUSIVE lock until the last
 *   revision in the chain completes.
 *
 * A revision whose first line is `-- migrate: no-transaction` runs statement by
 * statement outside a transaction (Postgres rejects CREATE INDEX CONCURRENTLY
 * inside one). Applied revisions are recorded in `__app_migrations`.
 *
 * Usage: `node dist/app/cli/migrate.js [--status]`
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import postgres, { type Sql } from 'postgres';

import { settings } from '../config.js';
import { getLogger } from '../observability/index.js';
import { isMain, runJob } from './_runner.js';

export const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', 'migrations');
export const MIGRATIONS_TABLE = '__app_migrations';
export const NO_TRANSACTION_MARKER = '-- migrate: no-transaction';
const STATEMENT_BREAKPOINT = '--> statement-breakpoint';
const DEFAULT_LOCK_TIMEOUT = process.env.MIGRATION_LOCK_TIMEOUT ?? '10s';
const log = getLogger('app.cli.migrate');

interface JournalEntry {
  readonly idx: number;
  readonly tag: string;
}

interface Journal {
  readonly entries: readonly JournalEntry[];
}

/** One revision as written by drizzle-kit and interpreted by this runner. */
export interface Revision {
  readonly idx: number;
  readonly tag: string;
  readonly file: string;
  readonly hash: string;
  readonly transactional: boolean;
  readonly statements: readonly string[];
}

/** Split a revision file on drizzle-kit's statement breakpoints. */
export function splitStatements(text: string): string[] {
  return text
    .split(STATEMENT_BREAKPOINT)
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '');
}

/** Read every revision in journal order. Missing files fail loudly. */
export function readRevisions(dir: string = MIGRATIONS_DIR): Revision[] {
  const journalPath = path.join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as Journal;
  return [...journal.entries]
    .sort((a, b) => a.idx - b.idx)
    .map((entry) => {
      const file = path.join(dir, `${entry.tag}.sql`);
      const text = readFileSync(file, 'utf8');
      return {
        idx: entry.idx,
        tag: entry.tag,
        file,
        hash: createHash('sha256').update(text).digest('hex'),
        transactional: !text.trimStart().startsWith(NO_TRANSACTION_MARKER),
        statements: splitStatements(text),
      };
    });
}

async function ensureTable(client: Sql): Promise<void> {
  await client.unsafe(
    `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (` +
      'id serial PRIMARY KEY, tag text NOT NULL UNIQUE, hash text NOT NULL, ' +
      'applied_at timestamptz NOT NULL DEFAULT now())',
  );
}

async function appliedTags(client: Sql): Promise<Set<string>> {
  const rows = await client.unsafe<{ tag: string }[]>(`SELECT tag FROM ${MIGRATIONS_TABLE}`);
  return new Set(rows.map((row) => row.tag));
}

async function applyRevision(client: Sql, revision: Revision): Promise<void> {
  const record = async (executor: Sql): Promise<void> => {
    await executor.unsafe(`INSERT INTO ${MIGRATIONS_TABLE} (tag, hash) VALUES ($1, $2)`, [
      revision.tag,
      revision.hash,
    ]);
  };
  if (revision.transactional) {
    await client.begin(async (tx) => {
      for (const statement of revision.statements) {
        await tx.unsafe(statement);
      }
      await record(tx as unknown as Sql);
    });
    return;
  }
  for (const statement of revision.statements) {
    await client.unsafe(statement);
  }
  await record(client);
}

export interface MigrateOptions {
  readonly dir?: string;
  readonly lockTimeout?: string;
}

/** Apply every pending revision through `client` (which must be a single connection). */
export async function migrate(client: Sql, options: MigrateOptions = {}): Promise<string[]> {
  const revisions = readRevisions(options.dir ?? MIGRATIONS_DIR);
  await client.unsafe(`SELECT set_config('lock_timeout', $1, false)`, [
    options.lockTimeout ?? DEFAULT_LOCK_TIMEOUT,
  ]);
  await ensureTable(client);
  const applied = await appliedTags(client);
  const done: string[] = [];
  for (const revision of revisions) {
    if (applied.has(revision.tag)) {
      continue;
    }
    log.info({ tag: revision.tag, transactional: revision.transactional }, 'applying revision');
    await applyRevision(client, revision);
    done.push(revision.tag);
  }
  return done;
}

/** Tags in the journal that the database has not applied. */
export async function pending(client: Sql, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  await ensureTable(client);
  const applied = await appliedTags(client);
  return readRevisions(dir)
    .map((revision) => revision.tag)
    .filter((tag) => !applied.has(tag));
}

/** Entrypoint: `--status` reports; otherwise apply. Uses a dedicated single connection. */
export async function main(): Promise<number> {
  const client = postgres(settings.databaseUrl, { max: 1, onnotice: () => undefined });
  try {
    if (process.argv.includes('--status')) {
      const waiting = await pending(client);
      log.info({ pending: waiting }, `${waiting.length} pending revision(s)`);
      return 0;
    }
    const applied = await migrate(client);
    log.info({ applied }, `applied ${applied.length} revision(s)`);
    return 0;
  } finally {
    await client.end({ timeout: 5 });
  }
}

if (isMain(import.meta)) {
  await runJob('migrate', main);
}
