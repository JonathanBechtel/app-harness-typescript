/**
 * Guard the `app/cli` (shipped runtime jobs) vs `scripts/` (operator tooling) boundary.
 *
 * E1  No deploy configuration (`deploy/**`, `.github/workflows/**`, `Dockerfile`)
 *     invokes a `scripts/` path as a runtime command. Runtime jobs run as
 *     `node dist/app/cli/<job>.js`.
 * E2  Nothing under `app/` imports from `scripts/`; the shipped package must
 *     not depend on operator tooling. Baseline in `KNOWN_APP_IMPORTS_SCRIPTS`
 *     may shrink, never grow (currently empty).
 * E3  Nothing under `app/` references a path `.dockerignore` excludes
 *     (`scripts/`, `tests/`, `docs/` ...). Such a read passes CI and breaks at
 *     runtime in the container. The excluded set is read from `.dockerignore`
 *     itself so the two cannot drift. Comments are exempt; string literals and
 *     template text are not.
 */

import { globSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import { importedModules, lineOf, parseSource, walk } from './_ast.js';
import {
  displayPath,
  gitTrackedFiles,
  isFile,
  isMain,
  readText,
  REPO,
  report,
} from './_check-runner.js';

export const KNOWN_APP_IMPORTS_SCRIPTS: ReadonlySet<string> = new Set();
const DEPLOY_GLOBS = [
  'deploy/**/*',
  '.github/workflows/*.yml',
  '.github/workflows/*.yaml',
  'Dockerfile',
];
const SCRIPTS_INVOCATION =
  /(\bnode\s+|\btsx\s+|\bnpx\s+tsx\s+|\bnpm\s+exec\s+tsx\s+|^\s*-\s*)scripts\/[\w./-]+/;
const CHECKOUT_MARKERS = [
  'npm run',
  'npm ci',
  'check-',
  'eslint',
  'vitest',
  'prettier',
  'tsc',
  'bootstrap-env',
];

/** Top-level directories .dockerignore excludes (trailing-slash entries). */
export function excludedDirs(file: string = path.join(REPO, '.dockerignore')): Set<string> {
  const dirs = new Set<string>();
  for (const raw of readText(file).split('\n')) {
    const line = raw.trim();
    if (
      line === '' ||
      line.startsWith('#') ||
      line.startsWith('!') ||
      line.includes('*') ||
      line.startsWith('.')
    ) {
      continue;
    }
    if (line.endsWith('/')) {
      dirs.add(line.slice(0, -1));
    }
  }
  return dirs;
}

export function checkE1(): string[] {
  const out: string[] = [];
  for (const pattern of DEPLOY_GLOBS) {
    for (const rel of globSync(pattern, { cwd: REPO })) {
      const file = path.join(REPO, rel);
      if (!isFile(file) || file.endsWith('.md')) {
        continue;
      }
      readText(file)
        .split('\n')
        .forEach((line, i) => {
          const stripped = line.trim();
          if (stripped.startsWith('#') || CHECKOUT_MARKERS.some((m) => stripped.includes(m))) {
            return; // CI steps legitimately run checks from a checkout
          }
          if (SCRIPTS_INVOCATION.test(stripped)) {
            out.push(
              `${displayPath(file)}:${i + 1}: E1 deploy config invokes scripts/ as a runtime command; use \`node dist/app/cli/<job>.js\``,
            );
          }
        });
    }
  }
  return out;
}

function referencesExcluded(value: string, excluded: ReadonlySet<string>): string | undefined {
  for (const dir of excluded) {
    if (value === dir || value.startsWith(`${dir}/`) || value.includes(`/${dir}/`)) {
      return dir;
    }
  }
  return undefined;
}

function literalText(node: ts.Node): string | undefined {
  if (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node)
  ) {
    const parent: ts.Node | undefined = node.parent;
    const isModuleSpecifier =
      parent !== undefined && (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent));
    return isModuleSpecifier ? undefined : node.text;
  }
  return undefined;
}

function checkImports(display: string, source: ts.SourceFile): string[] {
  const out: string[] = [];
  for (const { module, node } of importedModules(source)) {
    if (
      /(^|\/)scripts(\/|$)/.test(module) &&
      !KNOWN_APP_IMPORTS_SCRIPTS.has(`${display}:${module}`)
    ) {
      out.push(
        `${display}:${lineOf(source, node)}: E2 app/ must not import \`${module}\` (operator tooling)`,
      );
    }
  }
  return out;
}

function checkLiterals(
  display: string,
  source: ts.SourceFile,
  excluded: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  for (const node of walk(source)) {
    const value = literalText(node);
    const hit = value === undefined ? undefined : referencesExcluded(value, excluded);
    if (value !== undefined && hit !== undefined) {
      out.push(
        `${display}:${lineOf(source, node)}: E3 references \`${value}\`, which .dockerignore excludes from the image (${hit}/)`,
      );
    }
  }
  return out;
}

export function checkE2E3(
  appFiles: readonly string[],
  excluded: ReadonlySet<string> = excludedDirs(),
): string[] {
  const out: string[] = [];
  for (const file of appFiles) {
    const source = parseSource(file, readText(file));
    const display = displayPath(file);
    out.push(...checkImports(display, source), ...checkLiterals(display, source, excluded));
  }
  return out;
}

export function main(): number {
  const appFiles = gitTrackedFiles(/^app\//).map((f) => path.join(REPO, f));
  if (appFiles.length === 0) {
    console.error('no files matched app/ -- guard would pass vacuously');
    return 1;
  }
  return report('Runtime entrypoint boundary', [...checkE1(), ...checkE2E3(appFiles)], {
    okMessage: 'runtime entrypoints: OK',
    footer:
      'Shipped code lives in app/ and reads only app/data; operator tooling lives in scripts/.',
  });
}

if (isMain(import.meta)) {
  process.exitCode = main();
}
