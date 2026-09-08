/**
 * Diff-scoped migration-safety checker for drizzle-kit revisions.
 *
 * Failure this descends from: a release migration's non-concurrent `CREATE
 * INDEX` queued behind a long transaction; the deploy stalled in the lock
 * queue, the pool filled, public routes 500'd for over an hour. Deploy-time lock
 * contention should degrade the DEPLOY -- a fast, retryable failure -- never
 * production reads.
 *
 * Rules, diff-scoped to revisions this changeset adds or edits:
 *
 *   M1  Every `CREATE INDEX` statement is `CREATE INDEX CONCURRENTLY`.
 *   M2  A revision holding a CONCURRENTLY statement starts with the
 *       `-- migrate: no-transaction` marker (Postgres rejects CONCURRENTLY inside a
 *       transaction, and app/cli/migrate.ts runs each revision in one). M1
 *       without M2 turns a lock hazard into a guaranteed failed release.
 *   M3  A no-transaction revision holds ONLY concurrent index statements, so
 *       nothing that needs atomicity runs outside a transaction.
 *   M4  `app/cli/migrate.ts` keeps an EXECUTED `lock_timeout` statement and a
 *       per-revision `begin(` (checked whenever the runner is in the diff).
 *   M5  The journal is linear and complete: indexes 0..n-1 with no gaps or
 *       duplicates, every entry's .sql file present, every .sql file journalled.
 *
 * Waiver: `-- discipline: migration-safety <reason>` on the statement or the
 * comment line above it (small or empty tables may build indexes non-concurrently).
 */

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import { parseSource, stringValue, trailingName, walk } from './_ast.js';
import {
  againstArg,
  displayPath,
  git,
  GitError,
  isMain,
  mergeBase,
  readText,
  REPO,
  report,
  untrackedFiles,
} from './_check-runner.js';
import { statementHasReasonedWaiver } from './_discipline.js';

export const MIGRATIONS = path.join(REPO, 'app', 'migrations');
export const RUNNER = path.join(REPO, 'app', 'cli', 'migrate.ts');
export const RULE = 'migration-safety';
export const NO_TRANSACTION_MARKER = '-- migrate: no-transaction';
const BREAKPOINT = '--> statement-breakpoint';
const CREATE_INDEX = /\bCREATE\s+(UNIQUE\s+)?INDEX\b/i;
const CONCURRENTLY = /\bCONCURRENTLY\b/i;
const INDEX_ONLY = /^\s*(CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY|DROP\s+INDEX\s+CONCURRENTLY)\b/i;

/** Revisions (and the runner) added or modified vs the merge base. */
export function changedMigrationFiles(against: string): string[] {
  const base = mergeBase(against);
  const diffed = git([
    'diff',
    '--name-only',
    '--diff-filter=AM',
    base,
    '--',
    'app/migrations/',
    'app/cli/migrate.ts',
  ]).split('\n');
  const files = [...diffed, ...untrackedFiles(['app/migrations/', 'app/cli/migrate.ts'])];
  return files
    .filter((f) => f !== '' && (f.endsWith('.sql') || f.endsWith('migrate.ts')))
    .map((f) => path.join(REPO, f));
}

interface Statement {
  readonly text: string;
  readonly firstLine: number;
  readonly lastLine: number;
}

function statements(text: string): Statement[] {
  const out: Statement[] = [];
  let line = 1;
  for (const chunk of text.split(BREAKPOINT)) {
    const leading = chunk.length - chunk.trimStart().length;
    const firstLine = line + (chunk.slice(0, leading).match(/\n/g) ?? []).length;
    const body = chunk.trim();
    const lastLine = firstLine + (body.match(/\n/g) ?? []).length;
    if (body !== '') {
      out.push({ text: body, firstLine, lastLine });
    }
    line += (chunk.match(/\n/g) ?? []).length + 1;
  }
  return out;
}

/** M1-M3 violations in one revision file. */
export function checkRevision(file: string): string[] {
  const text = readText(file);
  const lines = text.split('\n');
  const rel = displayPath(file);
  const noTransaction = text.trimStart().startsWith(NO_TRANSACTION_MARKER);
  const out: string[] = [];
  let concurrent = false;
  for (const statement of statements(text)) {
    if (statementHasReasonedWaiver(lines, statement.firstLine, statement.lastLine, RULE)) {
      continue;
    }
    const isIndex = CREATE_INDEX.test(statement.text);
    if (isIndex && !CONCURRENTLY.test(statement.text)) {
      out.push(`${rel}:${statement.firstLine}: M1 CREATE INDEX must be CREATE INDEX CONCURRENTLY`);
      continue;
    }
    if (CONCURRENTLY.test(statement.text)) {
      concurrent = true;
    }
    const sqlOnly = statement.text
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    if (noTransaction && !INDEX_ONLY.test(sqlOnly)) {
      out.push(
        `${rel}:${statement.firstLine}: M3 a no-transaction revision may hold only concurrent index statements; move this to a transactional revision`,
      );
    }
  }
  if (concurrent && !noTransaction) {
    out.push(
      `${rel}:1: M2 CONCURRENTLY needs the revision to start with \`${NO_TRANSACTION_MARKER}\``,
    );
  }
  return out;
}

function mentionsLockTimeout(node: ts.Node): boolean {
  if (ts.isCallExpression(node)) {
    const name = trailingName(node.expression);
    return (
      (name === 'unsafe' || name === 'execute') &&
      (stringValue(node.arguments[0]) ?? '').includes('lock_timeout')
    );
  }
  return (
    ts.isTaggedTemplateExpression(node) &&
    (stringValue(node.template) ?? '').includes('lock_timeout')
  );
}

function isBeginCall(node: ts.Node): boolean {
  return ts.isCallExpression(node) && trailingName(node.expression) === 'begin';
}

/** M4: the runner executes a lock_timeout and runs each revision in its own transaction. */
export function checkRunner(file: string = RUNNER): string[] {
  const nodes = [...walk(parseSource(file, readText(file)))];
  const out: string[] = [];
  if (!nodes.some(mentionsLockTimeout)) {
    out.push(
      `${displayPath(file)}: M4 must EXECUTE a \`set_config('lock_timeout', ...)\` statement before applying revisions`,
    );
  }
  if (!nodes.some(isBeginCall)) {
    out.push(
      `${displayPath(file)}: M4 must apply each revision inside its own \`client.begin(...)\` transaction`,
    );
  }
  return out;
}

interface Journal {
  readonly entries: readonly { readonly idx: number; readonly tag: string }[];
}

/** M5: the journal is linear and complete (an empty journal is fine). */
export function checkJournal(dir: string = MIGRATIONS): string[] {
  const journalPath = path.join(dir, 'meta', '_journal.json');
  if (!existsSync(journalPath)) {
    return existsSync(dir) ? [`${displayPath(dir)}: M5 meta/_journal.json is missing`] : [];
  }
  const journal = JSON.parse(readText(journalPath)) as Journal;
  const out: string[] = [];
  const sorted = [...journal.entries].sort((a, b) => a.idx - b.idx);
  sorted.forEach((entry, i) => {
    if (entry.idx !== i) {
      out.push(
        `${displayPath(journalPath)}: M5 expected idx ${i}, found ${entry.idx} (${entry.tag}); two branches added a revision -- regenerate`,
      );
    }
    if (!existsSync(path.join(dir, `${entry.tag}.sql`))) {
      out.push(
        `${displayPath(journalPath)}: M5 journal names ${entry.tag}.sql but the file is missing`,
      );
    }
  });
  const tags = new Set(sorted.map((e) => e.tag));
  if (tags.size !== sorted.length) {
    out.push(`${displayPath(journalPath)}: M5 duplicate tags in journal`);
  }
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    if (!tags.has(file.slice(0, -4))) {
      out.push(
        `${displayPath(path.join(dir, file))}: M5 revision file is not in meta/_journal.json`,
      );
    }
  }
  return out;
}

export function main(argv: readonly string[]): number {
  let changed: string[];
  try {
    changed = changedMigrationFiles(againstArg(argv));
  } catch (error) {
    if (!(error instanceof GitError)) {
      throw error;
    }
    console.error(`migration safety: git failed: ${error.message}`);
    return 1;
  }
  const violations: string[] = [];
  for (const file of changed) {
    if (!existsSync(file)) {
      continue;
    }
    if (path.resolve(file) === RUNNER) {
      violations.push(...checkRunner(file));
    } else if (file.endsWith('.sql') && path.dirname(file) === MIGRATIONS) {
      violations.push(...checkRevision(file));
    }
  }
  violations.push(...checkJournal());
  return report('Migration safety', violations, {
    okMessage: 'migration safety: OK',
    footer:
      'See scripts/check-migration-safety.ts; waive per-statement with `-- discipline: migration-safety <reason>`.',
  });
}

if (isMain(import.meta)) {
  process.exitCode = main(process.argv.slice(2));
}
