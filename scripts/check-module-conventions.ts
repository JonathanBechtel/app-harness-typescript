/**
 * Enforce directory-scoped module placement and naming (`.module-conventions.yml`).
 *
 * Enrollment is opt-in per directory. For each enrolled path and rule family
 * (helpers, models, services, transformers, repositories):
 *
 *   MODC001  a file under `<path>/<family>/` must end with the family suffix;
 *   MODC002  a file at `<path>/` whose name carries a family suffix must live
 *            under that family's directory;
 *   MODC003  a file at `<path>/` whose shape looks like a family (exports a
 *            `pgTable`/`z.object` -> models; imports repositories/models or takes a
 *            `DbHandle` -> services; only functions -> helpers) is flagged with a
 *            relocation hint;
 *   MODC004  an enrolled rule's directory must exist.
 *
 * Flat layout is also accepted: `<path>/foo-service.ts` directly under an
 * enrolled `services` path passes when `<path>` itself IS the family directory
 * (e.g. `app/services`). `index.ts`, `_private.ts` and test files are exempt.
 */

import { statSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { parse as parseYaml } from 'yaml';

import { importedModules, parseSource, trailingName, walk } from './_ast.js';
import {
  displayPath,
  gitTrackedFiles,
  isFile,
  isMain,
  readText,
  REPO,
  runCli,
} from './_check-runner.js';

export const CONFIG = path.join(REPO, '.module-conventions.yml');
export const SUFFIXES: Readonly<Record<string, string>> = {
  helpers: '-helpers.ts',
  models: '-models.ts',
  services: '-service.ts',
  transformers: '-transformer.ts',
  repositories: '-repository.ts',
};
const MODEL_FACTORIES = new Set(['pgTable', 'pgEnum', 'object', 'enum']);
const HANDLE_TYPES = new Set(['Db', 'Tx', 'DbHandle']);

export interface Enrolled {
  readonly path: string;
  readonly rules: ReadonlySet<string>;
}

interface RawConfig {
  enforced_directories?: { path: string; rules?: string[] }[];
}

/** Enrolled directories from the YAML config. */
export function loadConfig(file: string = CONFIG): Enrolled[] {
  const raw = (parseYaml(readText(file)) ?? {}) as RawConfig;
  return (raw.enforced_directories ?? []).map((item, i) => {
    const rules = new Set(item.rules ?? []);
    const unknown = [...rules].filter((r) => !(r in SUFFIXES));
    if (rules.size === 0 || unknown.length > 0) {
      throw new Error(
        `${file}: enforced_directories[${i}] rules must be a non-empty subset of ${Object.keys(SUFFIXES).sort().join(', ')}`,
      );
    }
    return { path: path.resolve(REPO, item.path), rules };
  });
}

function isExempt(file: string): boolean {
  const name = path.basename(file);
  return (
    !name.endsWith('.ts') ||
    name === 'index.ts' ||
    name.startsWith('_') ||
    name.endsWith('.test.ts') ||
    name.endsWith('.d.ts')
  );
}

function scanShape(source: ts.SourceFile): { usesHandle: boolean; hasModelFactory: boolean } {
  let usesHandle = false;
  let hasModelFactory = false;
  for (const node of walk(source)) {
    if (ts.isCallExpression(node) && MODEL_FACTORIES.has(trailingName(node.expression) ?? '')) {
      hasModelFactory = true;
    } else if (
      ts.isTypeReferenceNode(node) &&
      HANDLE_TYPES.has(trailingName(node.typeName) ?? '')
    ) {
      usesHandle = true;
    }
  }
  return { usesHandle, hasModelFactory };
}

function inferFamily(source: ts.SourceFile): string | undefined {
  const { usesHandle, hasModelFactory } = scanShape(source);
  if (hasModelFactory) {
    return 'models';
  }
  const imports = importedModules(source).map((i) => i.module);
  if (usesHandle || imports.some((m) => /(^|\/)(repositories|models)(\/|$)/.test(m))) {
    return 'services';
  }
  const defs = source.statements.filter(
    (s) => ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s),
  );
  return defs.length > 0 && defs.every((s) => ts.isFunctionDeclaration(s)) ? 'helpers' : undefined;
}

function checkRootFile(file: string, entry: Enrolled, display: string): string[] {
  if (entry.rules.has(path.basename(entry.path))) {
    const suffix = SUFFIXES[path.basename(entry.path)] ?? '';
    return path.basename(file).endsWith(suffix)
      ? []
      : [`${display}: MODC001 files in ${path.basename(entry.path)}/ must end with ${suffix}`];
  }
  for (const family of entry.rules) {
    if (path.basename(file).endsWith(SUFFIXES[family] ?? '')) {
      return [`${display}: MODC002 belongs under ${displayPath(entry.path)}/${family}/`];
    }
  }
  const family = inferFamily(parseSource(file, readText(file)));
  if (family !== undefined && entry.rules.has(family)) {
    return [
      `${display}: MODC003 looks like ${family} code; move it under ${family}/ and name it *${SUFFIXES[family] ?? ''}`,
    ];
  }
  return [];
}

function enrolledFor(
  file: string,
  entries: readonly Enrolled[],
): { entry: Enrolled; rel: string } | undefined {
  for (const entry of entries) {
    const rel = path.relative(entry.path, file);
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
      return { entry, rel };
    }
  }
  return undefined;
}

/** Violations for one file. */
export function checkFile(file: string, entries: readonly Enrolled[]): string[] {
  const resolved = path.resolve(file);
  const match = isExempt(resolved) ? undefined : enrolledFor(resolved, entries);
  if (match === undefined) {
    return [];
  }
  const display = displayPath(resolved);
  const parts = match.rel.split(path.sep);
  if (parts.length === 1) {
    return checkRootFile(resolved, match.entry, display);
  }
  const family = parts[0] ?? '';
  const suffix = SUFFIXES[family] ?? '';
  if (match.entry.rules.has(family) && !path.basename(resolved).endsWith(suffix)) {
    return [`${display}: MODC001 files in ${family}/ must end with ${suffix}`];
  }
  return [];
}

/** Violations for the given paths. */
export function checkPaths(paths: readonly string[]): string[] {
  const entries = loadConfig();
  const out: string[] = [];
  for (const file of paths) {
    if (isFile(file)) {
      out.push(...checkFile(file, entries));
    }
  }
  return out;
}

/** Violations across every enrolled directory (+ MODC004 missing dirs). */
export function checkAll(): string[] {
  const entries = loadConfig();
  const tracked = gitTrackedFiles(/^app\//).map((f) => path.join(REPO, f));
  const out: string[] = [];
  for (const entry of entries) {
    if (!isDirectory(entry.path)) {
      out.push(`${displayPath(entry.path)}: MODC004 enrolled directory does not exist`);
      continue;
    }
    for (const family of [...entry.rules].sort()) {
      if (path.basename(entry.path) !== family && !isDirectory(path.join(entry.path, family))) {
        out.push(`${displayPath(entry.path)}: MODC004 missing required ${family}/ subdirectory`);
      }
    }
    for (const file of tracked) {
      if (!path.relative(entry.path, file).startsWith('..')) {
        out.push(...checkFile(file, entries));
      }
    }
  }
  return out;
}

function isDirectory(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

export function main(argv: readonly string[]): number {
  return runCli(argv, {
    checkAll,
    checkPaths,
    label: 'Module conventions',
    scriptPath: import.meta.filename,
    configPaths: [CONFIG],
    footer: 'See docs/guides/module-conventions.md.',
  });
}

if (isMain(import.meta)) {
  process.exitCode = main(process.argv.slice(1));
}
