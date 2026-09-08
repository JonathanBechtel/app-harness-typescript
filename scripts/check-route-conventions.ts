/**
 * Enforce route conventions across `app/api`, `app/web`, and `app/templates`.
 *
 * Rules (each violation prints `path:line: [CODE] message`):
 *
 *   R1  Every `app.<method>(url, options, handler)` / `app.route({...})` declares
 *       a response shape: `schema.response` (JSON via Zod, or `HtmlPage` for
 *       server-rendered pages). Catches accidentally untyped APIs.
 *   R2  POST/PUT/PATCH/DELETE routes declare their status codes explicitly: every
 *       `schema.response` key is a numeric status (no `default`, no `2xx`).
 *   R3  Route modules reach the database only through `app.db`
 *       (`app/api/deps.ts`): no importing the module-level `db`/`sql` client from
 *       `app/utils/db` (functions like the readiness probe are fine), no
 *       `postgres(...)` / `drizzle(...)` built inline.
 *   R4  Every page template (`app/templates/*.njk` other than `base.njk` and
 *       partials) starts with `{% extends "base.njk" %}`.
 *
 * Names are resolved through the module's alias map, so `import { x as y }` cannot
 * turn a rule off. Escape hatch: `// discipline: route-conventions <reason>` on
 * the route statement or the comment block above it.
 */

import path from 'node:path';

import ts from 'typescript';

import {
  importedModules,
  lineOf,
  moduleAliases,
  objectProperty,
  parseSource,
  propertyName,
  resolve,
  resolvedCallName,
  rootName,
  statementOf,
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
import { lineHasReasonedWaiver, statementHasReasonedWaiver } from './_discipline.js';

export const RULE = 'route-conventions';
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all']);
const WRITE_METHODS = new Set(['post', 'put', 'patch', 'delete']);
const ROUTER_NAMES = new Set(['app', 'fastify', 'router', 'server', 'instance']);
const CLIENT_FACTORIES = new Set(['postgres', 'drizzle', 'Pool', 'Client']);
/** Module-level client bindings in app/utils/db that routes must not import (functions are fine). */
const CLIENT_BINDINGS = new Set(['db', 'sql']);
const DB_MODULE = /(^|\/)utils\/db(\.js|\.ts)?$/;
const EXTENDS_BASE = /^\{%-?\s*extends\s+["']base\.njk["']\s*-?%\}/;

interface Violation {
  readonly file: string;
  readonly line: number;
  readonly code: string;
  readonly message: string;
}

function format(v: Violation): string {
  return `${v.file}:${v.line}: [${v.code}] ${v.message}`;
}

/** `app.get(...)` -> "get"; `app.route({...})` -> "route"; else undefined. */
function routerCall(
  call: ts.CallExpression,
  aliases: ReadonlyMap<string, string>,
): string | undefined {
  if (!ts.isPropertyAccessExpression(call.expression)) {
    return undefined;
  }
  const method = call.expression.name.text;
  if (method !== 'route' && !HTTP_METHODS.has(method)) {
    return undefined;
  }
  const receiver = resolve(rootName(call.expression.expression), aliases);
  return receiver !== undefined && ROUTER_NAMES.has(receiver) ? method : undefined;
}

function optionsLiteral(
  call: ts.CallExpression,
  method: string,
): ts.ObjectLiteralExpression | undefined | null {
  const candidate = method === 'route' ? call.arguments[0] : call.arguments[1];
  if (
    candidate === undefined ||
    ts.isArrowFunction(candidate) ||
    ts.isFunctionExpression(candidate)
  ) {
    return null; // no options at all: the handler sits where options would be
  }
  return ts.isObjectLiteralExpression(candidate) ? candidate : undefined; // non-literal: cannot verify
}

function responseLiteral(
  options: ts.ObjectLiteralExpression,
): ts.ObjectLiteralExpression | undefined | null {
  const schema = objectProperty(options, 'schema');
  if (schema === undefined || !ts.isPropertyAssignment(schema)) {
    return null;
  }
  if (!ts.isObjectLiteralExpression(schema.initializer)) {
    return undefined;
  }
  const response = objectProperty(schema.initializer, 'response');
  if (response === undefined || !ts.isPropertyAssignment(response)) {
    return null;
  }
  return ts.isObjectLiteralExpression(response.initializer) ? response.initializer : undefined;
}

function routeMethod(
  method: string,
  options: ts.ObjectLiteralExpression | undefined | null,
): string {
  if (method !== 'route' || options === undefined || options === null) {
    return method;
  }
  const declared = objectProperty(options, 'method');
  if (
    declared !== undefined &&
    ts.isPropertyAssignment(declared) &&
    ts.isStringLiteral(declared.initializer)
  ) {
    return declared.initializer.text.toLowerCase();
  }
  return method;
}

function checkRoute(
  file: string,
  source: ts.SourceFile,
  call: ts.CallExpression,
  method: string,
): Violation[] {
  const out: Violation[] = [];
  const line = lineOf(source, call);
  const handlerName = `${trailingName(call.expression) ?? method} ${stringOf(call.arguments[0])}`;
  const options = optionsLiteral(call, method);
  const verb = routeMethod(method, options);
  if (options === undefined) {
    return out; // options object is not a literal: cannot verify statically
  }
  const response = options === null ? null : responseLiteral(options);
  if (response === null) {
    out.push({
      file,
      line,
      code: 'R1',
      message: `${handlerName} needs schema.response (Zod shape, or HtmlPage for pages)`,
    });
    return out;
  }
  if (response !== undefined && WRITE_METHODS.has(verb)) {
    const keys = response.properties.map((p) =>
      ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)
        ? propertyName(p.name)
        : undefined,
    );
    if (keys.length === 0 || keys.some((k) => k === undefined || !/^\d{3}$/.test(k))) {
      out.push({
        file,
        line,
        code: 'R2',
        message: `${handlerName} must declare explicit numeric status codes in schema.response (201 create, 204 delete); no default/2xx`,
      });
    }
  }
  return out;
}

function stringOf(node: ts.Node | undefined): string {
  return node !== undefined && ts.isStringLiteral(node) ? `'${node.text}'` : '';
}

function isTypeOnlyImport(node: ts.Node): boolean {
  return (
    ts.isImportDeclaration(node) && node.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword
  );
}

/** Named bindings an import brings in (`import { db, type Db } from ...` -> ["db"]). */
function valueBindings(node: ts.Node): string[] {
  if (!ts.isImportDeclaration(node) || isTypeOnlyImport(node)) {
    return [];
  }
  const bindings = node.importClause?.namedBindings;
  if (bindings === undefined || !ts.isNamedImports(bindings)) {
    return bindings === undefined ? [] : [bindings.name.text];
  }
  return bindings.elements.filter((e) => !e.isTypeOnly).map((e) => (e.propertyName ?? e.name).text);
}

function checkDbImports(file: string, source: ts.SourceFile): Violation[] {
  const out: Violation[] = [];
  for (const { module, node } of importedModules(source)) {
    const clients = DB_MODULE.test(module)
      ? valueBindings(node).filter((name) => CLIENT_BINDINGS.has(name))
      : [];
    if (clients.length > 0) {
      out.push({
        file,
        line: lineOf(source, node),
        code: 'R3',
        message: `route modules get the database via app.db (app/api/deps.ts), not by importing \`${clients.join(', ')}\` from app/utils/db`,
      });
    }
  }
  return out;
}

function checkClientFactories(
  file: string,
  source: ts.SourceFile,
  aliases: ReadonlyMap<string, string>,
): Violation[] {
  const out: Violation[] = [];
  for (const node of walk(source)) {
    if (!ts.isCallExpression(node) && !ts.isNewExpression(node)) {
      continue;
    }
    const name = ts.isNewExpression(node)
      ? resolve(trailingName(node.expression), aliases)
      : resolvedCallName(node, aliases);
    if (name !== undefined && CLIENT_FACTORIES.has(name)) {
      out.push({
        file,
        line: lineOf(source, node),
        code: 'R3',
        message: `\`${name}(...)\` builds a database client inline; use app.db`,
      });
    }
  }
  return out;
}

function checkDatabaseAccess(
  file: string,
  source: ts.SourceFile,
  aliases: ReadonlyMap<string, string>,
): Violation[] {
  return [...checkDbImports(file, source), ...checkClientFactories(file, source, aliases)];
}

function checkRouteModule(file: string): Violation[] {
  const text = readText(file);
  const source = parseSource(file, text);
  const lines = text.split('\n');
  const aliases = moduleAliases(source);
  const display = displayPath(file);
  const violations: Violation[] = [];
  for (const node of walk(source)) {
    if (!ts.isCallExpression(node)) {
      continue;
    }
    const method = routerCall(node, aliases);
    if (method === undefined) {
      continue;
    }
    const statement = statementOf(node);
    const first = statement === undefined ? lineOf(source, node) : lineOf(source, statement);
    const last =
      statement === undefined
        ? first
        : source.getLineAndCharacterOfPosition(statement.getEnd()).line + 1;
    if (statementHasReasonedWaiver(lines, first, last, RULE)) {
      continue;
    }
    violations.push(...checkRoute(display, source, node, method));
  }
  violations.push(...checkDatabaseAccess(display, source, aliases));
  return violations;
}

function checkTemplate(file: string): Violation[] {
  const name = path.basename(file);
  const rel = displayPath(file);
  if (name === 'base.njk' || name.startsWith('_') || rel.includes('/partials/')) {
    return [];
  }
  const lines = readText(file).split('\n');
  const first = lines.find((line) => line.trim() !== '');
  if (
    first !== undefined &&
    (EXTENDS_BASE.test(first.trim()) || lineHasReasonedWaiver(first, RULE))
  ) {
    return [];
  }
  return [
    {
      file: rel,
      line: 1,
      code: 'R4',
      message:
        'page templates must start with {% extends "base.njk" %} (shared head, assets, layout)',
    },
  ];
}

/** Formatted violations for the given files (`.ts` route modules, `.njk` templates). */
export function checkPaths(paths: readonly string[]): string[] {
  const found: Violation[] = [];
  for (const file of paths) {
    if (!isFile(file)) {
      continue;
    }
    if (file.endsWith('.ts')) {
      found.push(...checkRouteModule(file));
    } else if (file.endsWith('.njk')) {
      found.push(...checkTemplate(file));
    }
  }
  found.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.code.localeCompare(b.code),
  );
  return found.map(format);
}

/** Every tracked route module and template; fails loudly rather than passing on an empty match. */
export function checkAll(): string[] {
  const modules = gitTrackedFiles(/^app\/(api|web)\//);
  if (modules.length === 0) {
    throw new Error('no files matched app/(api|web) -- guard would pass vacuously');
  }
  const templates = gitTrackedFiles(/^app\/templates\//, '.njk');
  return checkPaths([...modules, ...templates].map((f) => path.join(REPO, f)));
}

export function main(argv: readonly string[]): number {
  return runCli(argv, {
    checkAll,
    checkPaths,
    label: 'Route conventions',
    scriptPath: import.meta.filename,
    footer: 'See scripts/check-route-conventions.ts for R1-R4.',
  });
}

if (isMain(import.meta)) {
  process.exitCode = main(process.argv.slice(1));
}
