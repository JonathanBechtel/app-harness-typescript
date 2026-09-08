/**
 * Ban `db.delete(table)` with no `.where(...)` — retain history by default.
 *
 * A bulk delete with no filter empties a table. "Wipe clean and recompute" is
 * the anti-pattern this guards against: it destroys the time axis. Recognised
 * on every drizzle handle spelling (`db`, `tx`, a parameter typed `Db`/`Tx`/
 * `DbHandle`, an alias of any of those), on `deleteFrom(...)`, and on raw
 * `DELETE FROM` SQL without a `WHERE` in `sql\`...\`` / `.execute()` / `.unsafe()`.
 * `map.delete(key)` on a non-database receiver is not flagged.
 *
 * Escape hatch (mandatory reason):
 *
 *     await db.delete(demo); // discipline: unscoped-delete demo table, seed script
 */

import path from 'node:path';

import ts from 'typescript';

import {
  endLineOf,
  lineOf,
  moduleAliases,
  parseSource,
  resolve,
  rootName,
  statementOf,
  stringValue,
  trailingName,
  walk,
} from './_ast.js';
import {
  displayPath,
  gitTrackedFiles,
  isFile,
  isMain,
  readText,
  REPO,
  runCli,
} from './_check-runner.js';
import { statementHasReasonedWaiver } from './_discipline.js';

export const RULE = 'unscoped-delete';
const HANDLE_NAMES = new Set(['db', 'tx', 'trx', 'database', 'handle', 'transaction']);
const HANDLE_TYPES = new Set([
  'Db',
  'Tx',
  'DbHandle',
  'PgDatabase',
  'PgTransaction',
  'PostgresJsDatabase',
]);
const SQL_SINKS = new Set(['sql', 'execute', 'unsafe', 'query']);
const RAW_DELETE = /\bDELETE\s+FROM\b/i;
const RAW_WHERE = /\bWHERE\b/i;

function typedHandleName(node: ts.Node): string | undefined {
  if (!ts.isParameter(node) && !ts.isVariableDeclaration(node)) {
    return undefined;
  }
  if (
    !ts.isIdentifier(node.name) ||
    node.type === undefined ||
    !ts.isTypeReferenceNode(node.type)
  ) {
    return undefined;
  }
  const typeName = trailingName(node.type.typeName);
  return typeName !== undefined && HANDLE_TYPES.has(typeName) ? node.name.text : undefined;
}

/** Names of parameters and variables typed as a database handle, plus the conventional names. */
function handleNames(source: ts.SourceFile, aliases: ReadonlyMap<string, string>): Set<string> {
  const names = new Set(HANDLE_NAMES);
  for (const node of walk(source)) {
    const name = typedHandleName(node);
    if (name !== undefined) {
      names.add(name);
    }
  }
  for (const [alias, original] of aliases) {
    if (names.has(original)) {
      names.add(alias);
    }
  }
  return names;
}

function isBulkDelete(
  call: ts.CallExpression,
  handles: ReadonlySet<string>,
  aliases: ReadonlyMap<string, string>,
): boolean {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) {
    return resolve(callee.text, aliases) === 'deleteFrom';
  }
  if (!ts.isPropertyAccessExpression(callee)) {
    return false;
  }
  if (callee.name.text === 'deleteFrom') {
    return true;
  }
  if (callee.name.text !== 'delete' || call.arguments.length === 0) {
    return false;
  }
  const root = resolve(rootName(callee.expression), aliases);
  return root !== undefined && handles.has(root);
}

/** Walk up the fluent chain from `call` looking for `.where(...)`. */
function hasWhereInChain(call: ts.CallExpression): boolean {
  let current: ts.Node = call;
  for (;;) {
    const parent: ts.Node | undefined = current.parent;
    if (
      parent === undefined ||
      !ts.isPropertyAccessExpression(parent) ||
      parent.expression !== current
    ) {
      return false;
    }
    if (parent.name.text === 'where') {
      return true;
    }
    const outer: ts.Node | undefined = parent.parent;
    if (outer === undefined || !ts.isCallExpression(outer) || outer.expression !== parent) {
      return false;
    }
    current = outer;
  }
}

function rawUnscopedDelete(node: ts.Node): boolean {
  let text: string | undefined;
  if (ts.isTaggedTemplateExpression(node) && SQL_SINKS.has(trailingName(node.tag) ?? '')) {
    text = stringValue(node.template);
  } else if (ts.isCallExpression(node) && SQL_SINKS.has(trailingName(node.expression) ?? '')) {
    text = stringValue(node.arguments[0]);
  }
  return text !== undefined && RAW_DELETE.test(text) && !RAW_WHERE.test(text);
}

interface Finding {
  readonly node: ts.Node;
  readonly raw: boolean;
}

function findings(
  source: ts.SourceFile,
  handles: ReadonlySet<string>,
  aliases: ReadonlyMap<string, string>,
): Finding[] {
  const out: Finding[] = [];
  for (const node of walk(source)) {
    if (
      ts.isCallExpression(node) &&
      isBulkDelete(node, handles, aliases) &&
      !hasWhereInChain(node)
    ) {
      out.push({ node, raw: false });
    } else if (rawUnscopedDelete(node)) {
      out.push({ node, raw: true });
    }
  }
  return out;
}

/** Unscoped bulk deletes in one file. */
export function checkFile(file: string): string[] {
  const text = readText(file);
  const source = parseSource(file, text);
  const lines = text.split('\n');
  const aliases = moduleAliases(source);
  const display = displayPath(file);
  const out: string[] = [];
  const flagged = new Set<ts.Statement | undefined>();
  for (const { node, raw } of findings(source, handleNames(source, aliases), aliases)) {
    const statement = statementOf(node);
    if (statement !== undefined && flagged.has(statement)) {
      continue;
    }
    const first = statement === undefined ? lineOf(source, node) : lineOf(source, statement);
    const last = statement === undefined ? first : endLineOf(source, statement);
    if (statementHasReasonedWaiver(lines, first, last, RULE)) {
      continue;
    }
    flagged.add(statement);
    const what = raw ? 'raw DELETE FROM with no WHERE' : 'delete(...) with no .where()';
    out.push(`${display}:${lineOf(source, node)}: unscoped ${what}; retain history by default`);
  }
  return out;
}

/** Violations for the given paths. */
export function checkPaths(paths: readonly string[]): string[] {
  const out: string[] = [];
  for (const file of paths) {
    if (file.endsWith('.ts') && isFile(file)) {
      out.push(...checkFile(file));
    }
  }
  return out;
}

/** Violations across app/ and scripts/. */
export function checkAll(): string[] {
  const files = gitTrackedFiles(/^(app|scripts)\//);
  if (files.length === 0) {
    throw new Error('no files matched app|scripts -- guard would pass vacuously');
  }
  return checkPaths(files.map((f) => path.join(REPO, f)));
}

export function main(argv: readonly string[]): number {
  return runCli(argv, {
    checkAll,
    checkPaths,
    label: 'Unscoped delete ban',
    scriptPath: import.meta.filename,
    footer: 'Add .where(...), or waive with `// discipline: unscoped-delete <reason>`.',
  });
}

if (isMain(import.meta)) {
  process.exitCode = main(process.argv.slice(1));
}
