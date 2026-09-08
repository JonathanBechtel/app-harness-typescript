/**
 * Ban explicit transaction control in request-bounded code.
 *
 * Routes and services use `withTransaction(db, async (tx) => ...)` so commit and
 * rollback are structural, not remembered. Runtime jobs (`app/cli`) and
 * `scripts/` may still manage transactions explicitly. Matches `.commit()`,
 * `.rollback()`, `startTransaction(...)`, a locally rebound name (through the
 * alias map), and raw `BEGIN` / `COMMIT` / `ROLLBACK` statements in SQL strings.
 */

import path from 'node:path';

import ts from 'typescript';

import {
  lineOf,
  moduleAliases,
  parseSource,
  resolvedCallName,
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

const FORBIDDEN_CALLS = new Set(['commit', 'rollback', 'startTransaction']);
const SQL_SINKS = new Set(['sql', 'execute', 'unsafe', 'query']);
const RAW_CONTROL = /^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION)\b/i;
const SCOPE = /^app\/(api|web|services)\//;

function rawControlStatement(
  call: ts.CallExpression | ts.TaggedTemplateExpression,
): string | undefined {
  const text = ts.isTaggedTemplateExpression(call)
    ? stringValue(call.template)
    : stringValue(call.arguments[0]);
  const match = text === undefined ? null : RAW_CONTROL.exec(text);
  return match?.[1]?.toUpperCase();
}

function callViolation(
  node: ts.CallExpression,
  aliases: ReadonlyMap<string, string>,
): string | undefined {
  const attr = ts.isPropertyAccessExpression(node.expression)
    ? node.expression.name.text
    : resolvedCallName(node, aliases);
  if (attr === undefined) {
    return undefined;
  }
  if (FORBIDDEN_CALLS.has(attr)) {
    return `explicit ${attr}() in request-bounded code`;
  }
  const control = SQL_SINKS.has(attr) ? rawControlStatement(node) : undefined;
  return control === undefined ? undefined : `raw ${control} statement in request-bounded code`;
}

function violationFor(node: ts.Node, aliases: ReadonlyMap<string, string>): string | undefined {
  if (ts.isCallExpression(node)) {
    return callViolation(node, aliases);
  }
  if (ts.isTaggedTemplateExpression(node) && SQL_SINKS.has(trailingName(node.tag) ?? '')) {
    const control = rawControlStatement(node);
    return control === undefined ? undefined : `raw ${control} statement in request-bounded code`;
  }
  return undefined;
}

function checkFile(file: string): string[] {
  const source = parseSource(file, readText(file));
  const aliases = moduleAliases(source);
  const display = displayPath(file);
  const out: string[] = [];
  for (const node of walk(source)) {
    const message = violationFor(node, aliases);
    if (message !== undefined) {
      out.push(`${display}:${lineOf(source, node)}: ${message}`);
    }
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
  return out.sort();
}

/** Violations across every tracked route/service module. */
export function checkAll(): string[] {
  const files = gitTrackedFiles(SCOPE);
  if (files.length === 0) {
    throw new Error('no files matched app/(api|web|services) -- guard would pass vacuously');
  }
  return checkPaths(files.map((f) => path.join(REPO, f)));
}

export function main(argv: readonly string[]): number {
  return runCli(argv, {
    checkAll,
    checkPaths,
    label: 'Request transaction policy',
    scriptPath: import.meta.filename,
    footer:
      'Use `withTransaction(db, async (tx) => ...)` in routes/services; explicit transaction control belongs in app/cli or scripts.',
  });
}

if (isMain(import.meta)) {
  process.exitCode = main(process.argv.slice(1));
}
