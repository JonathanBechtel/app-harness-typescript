/**
 * Shared CLI scaffolding for the repo's `scripts/check-*.ts` guards.
 *
 * Three families of checker share this module:
 *
 * - **Path-taking** (`check-route-conventions.ts` ...): receive changed files from
 *   lint-staged, or `--all` for a full git-tracked scan. `runCli` provides the
 *   argv parsing, the vacuity defense (a changeset touching the checker itself
 *   forces a full scan), and uniform reporting.
 * - **Whole-tree** (`check-complexity-ratchet.ts` ...): own their argv, use only
 *   `report`.
 * - **Diff-scoped at line granularity** (`check-test-titles.ts` ...): use
 *   `changedLineNumbers` / `diffScopedCli` so existing violations in untouched
 *   lines never fail the build.
 *
 * Every family refuses to pass on an empty scan: "checked nothing" must never
 * print OK.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(import.meta.dirname, '..');
export const RUNNER_FILENAME = '_check-runner.ts';
/** git's well-known empty tree object. */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export class GitError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly code: number | null,
    readonly stderr: string,
  ) {
    super(`git ${args.join(' ')} failed (${code ?? 'signal'}): ${stderr.trim()}`);
    this.name = 'GitError';
  }
}

/** True when `meta` belongs to the module Node was asked to run. */
export function isMain(meta: ImportMeta): boolean {
  const entry = process.argv[1];
  return entry !== undefined && path.resolve(entry) === fileURLToPath(meta.url);
}

/** Run git and return stdout; throws `GitError` on failure (unless `check` is false). */
export function git(
  args: readonly string[],
  options: { cwd?: string; check?: boolean } = {},
): string {
  const result = spawnSync('git', [...args], {
    cwd: options.cwd ?? REPO,
    encoding: 'utf8',
  });
  if ((options.check ?? true) && result.status !== 0) {
    throw new GitError(args, result.status, result.stderr);
  }
  return result.stdout;
}

/** Repo-relative POSIX path for display and for matching git output. */
export function displayPath(file: string, cwd: string = REPO): string {
  return path.relative(cwd, path.resolve(cwd, file)).split(path.sep).join('/');
}

/** Read a file as UTF-8 text. */
export function readText(file: string): string {
  return readFileSync(file, 'utf8');
}

/** True for an existing regular file. */
export function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/** Parse `--all` and positional paths; refuse both "nothing" spellings. `argv[0]` is the script. */
export function parseArgs(argv: readonly string[]): { scanAll: boolean; paths: string[] } {
  let scanAll = false;
  const paths: string[] = [];
  const unknown: string[] = [];
  for (const arg of argv.slice(1)) {
    if (arg === '--all') {
      scanAll = true;
    } else if (arg.startsWith('-')) {
      unknown.push(arg);
    } else {
      paths.push(arg);
    }
  }
  const script = argv[0] === undefined ? 'checker' : path.basename(argv[0]);
  if (unknown.length > 0) {
    throw new Error(
      `${script}: unknown option(s) ${unknown.join(' ')}; takes file paths and --all only.`,
    );
  }
  if (!scanAll && paths.length === 0) {
    throw new Error(
      `${script}: no paths given and --all not passed; refusing to report OK after checking nothing.`,
    );
  }
  return { scanAll, paths };
}

/** True when the checker, this runner, or a declared config file is in the changeset. */
export function isFullScanTrigger(
  changed: readonly string[],
  scriptPath: string,
  configPaths: readonly string[] = [],
): boolean {
  const scriptName = path.basename(scriptPath);
  const configs = new Set(configPaths.map((c) => path.resolve(c)));
  return changed.some((file) => {
    const resolved = path.resolve(file);
    const name = path.basename(resolved);
    return name === scriptName || name === RUNNER_FILENAME || configs.has(resolved);
  });
}

/** Git-tracked files matching `pattern` (regex on the repo-relative path) with `suffix`. */
export function gitTrackedFiles(pattern: RegExp, suffix = '.ts', cwd: string = REPO): string[] {
  return git(['ls-files'], { cwd })
    .split('\n')
    .filter((line) => line !== '' && line.endsWith(suffix) && pattern.test(line));
}

/**
 * Merge base of `ref` and HEAD; `ref` itself on a shallow clone; the empty tree before the first commit.
 *
 * A repository with no commits yet (a fresh template checkout) has no HEAD, so every
 * diff-scoped guard would crash. Diffing against the empty tree instead judges the
 * whole tree as newly added, which is exactly what a first commit is.
 */
export function mergeBase(ref: string, cwd: string = REPO): string {
  // cat-file -e, not rev-parse --verify: the latter accepts any well-formed 40-hex
  // string (e.g. GitHub's all-zero `before` sha on a first push) without checking
  // that the object exists.
  const probe = spawnSync('git', ['cat-file', '-e', `${ref}^{commit}`], { cwd, encoding: 'utf8' });
  if (probe.status !== 0) {
    return EMPTY_TREE;
  }
  const out = spawnSync('git', ['merge-base', ref, 'HEAD'], { cwd, encoding: 'utf8' });
  if (out.status !== 0) {
    return ref;
  }
  const base = out.stdout.trim();
  return base === '' ? ref : base;
}

/** Untracked, non-ignored files under `pathspec` (`git diff` never shows these). */
export function untrackedFiles(pathspec: readonly string[] = [], cwd: string = REPO): string[] {
  return git(['ls-files', '--others', '--exclude-standard', '--', ...pathspec], { cwd })
    .split('\n')
    .filter((line) => line !== '');
}

const DIFF_FILE = /^\+\+\+ b\/(.+)$/;
const DIFF_HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

function countLines(text: string): number {
  if (text === '') {
    return 0;
  }
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}

function addRange(target: Set<number>, start: number, count: number): void {
  for (let n = start; n < start + count; n += 1) {
    target.add(n);
  }
}

function parseUnifiedDiff(diff: string): Map<string, Set<number>> {
  const changed = new Map<string, Set<number>>();
  let current: Set<number> | undefined;
  for (const line of diff.split('\n')) {
    const fileMatch = DIFF_FILE.exec(line);
    if (fileMatch?.[1] !== undefined) {
      current = new Set();
      changed.set(fileMatch[1], current);
      continue;
    }
    const hunk = DIFF_HUNK.exec(line);
    if (hunk?.[1] !== undefined && current !== undefined) {
      addRange(current, Number(hunk[1]), Number(hunk[2] ?? '1'));
    }
  }
  return changed;
}

/**
 * Added/modified line numbers per file: merge base vs working tree, plus every line of untracked files.
 *
 * Untracked files are included so a checker run from a checkout before `git add`
 * judges new files the same way lint-staged (staged) and CI (committed) will.
 */
export function changedLineNumbers(
  against: string,
  pathspec: readonly string[] = [],
  cwd: string = REPO,
): Map<string, Set<number>> {
  const base = mergeBase(against, cwd);
  const changed = parseUnifiedDiff(
    git(['diff', '--no-color', '--unified=0', base, '--', ...pathspec], { cwd }),
  );
  for (const file of untrackedFiles(pathspec, cwd)) {
    const full = path.join(cwd, file);
    if (isFile(full)) {
      const lines = new Set<number>();
      addRange(lines, 1, countLines(readText(full)));
      changed.set(file, lines);
    }
  }
  return changed;
}

export type Finder = (file: string, source: string, changed: ReadonlySet<number>) => string[];

/** Which changed files a line-scoped checker looks at. */
export interface DiffScope {
  readonly pathspec: readonly string[];
  readonly onlyTests?: boolean;
  readonly suffix?: string;
}

function isTestFile(file: string): boolean {
  const name = path.basename(file);
  return name.endsWith('.test.ts') || name.endsWith('.spec.ts');
}

/** Run `find` over every changed file's changed lines. */
export function diffScopedViolations(
  against: string,
  scope: DiffScope,
  find: Finder,
  cwd: string = REPO,
): string[] {
  const violations: string[] = [];
  const suffix = scope.suffix ?? '.ts';
  const entries = [...changedLineNumbers(against, scope.pathspec, cwd).entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );
  for (const [file, lines] of entries) {
    if (lines.size === 0 || !file.endsWith(suffix)) {
      continue;
    }
    if (scope.onlyTests === true && !isTestFile(file)) {
      continue;
    }
    const full = path.join(cwd, file);
    if (isFile(full)) {
      violations.push(...find(file, readText(full), lines));
    }
  }
  return violations;
}

/** Parse `--against <ref>` (default HEAD) from a whole argv. */
export function againstArg(argv: readonly string[], fallback = 'HEAD'): string {
  const index = argv.indexOf('--against');
  if (index !== -1) {
    const value = argv[index + 1];
    if (value !== undefined) {
      return value;
    }
  }
  const inline = argv.find((arg) => arg.startsWith('--against='));
  return inline === undefined ? fallback : inline.slice('--against='.length);
}

/** Standard `--against` CLI for line-scoped checkers. */
export function diffScopedCli(
  argv: readonly string[],
  label: string,
  find: Finder,
  options: { scope: DiffScope; footer?: string },
): number {
  let violations: string[];
  try {
    violations = diffScopedViolations(againstArg(argv), options.scope, find);
  } catch (error) {
    if (error instanceof GitError) {
      console.error(`${label} failed to start: ${error.message}`);
      return 1;
    }
    throw error;
  }
  return report(label, violations, { footer: options.footer });
}

export interface ReportOptions {
  readonly okMessage?: string | undefined;
  readonly preamble?: string | undefined;
  readonly footer?: string | undefined;
}

/** Print the uniform report and return the exit code (0 clean, 1 violations). */
export function report(
  label: string,
  violations: readonly string[],
  options: ReportOptions = {},
): number {
  if (violations.length === 0) {
    if (options.okMessage !== undefined) {
      console.log(options.okMessage);
    }
    return 0;
  }
  const lines: string[] = [];
  if (options.preamble !== undefined && options.preamble !== '') {
    lines.push(options.preamble, '');
  }
  lines.push(`${label} failed:`, ...violations.map((v) => `  ${v}`));
  if (options.footer !== undefined && options.footer !== '') {
    lines.push('', options.footer);
  }
  console.error(lines.join('\n') + '\n');
  return 1;
}

/** A path-taking checker's callables and report text. */
export interface CheckSpec {
  readonly checkAll: () => string[];
  readonly checkPaths: (paths: readonly string[]) => string[];
  readonly label: string;
  readonly scriptPath: string;
  readonly configPaths?: readonly string[];
  readonly okMessage?: string;
  readonly preamble?: string;
  readonly footer?: string;
}

/** Standard path-taking checker loop with the vacuity defense. */
export function runCli(argv: readonly string[], spec: CheckSpec): number {
  let parsed: { scanAll: boolean; paths: string[] };
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  let scanAll = parsed.scanAll;
  if (!scanAll && isFullScanTrigger(parsed.paths, spec.scriptPath, spec.configPaths ?? [])) {
    scanAll = true;
  }
  let violations: string[];
  try {
    violations = scanAll ? spec.checkAll() : spec.checkPaths(parsed.paths);
  } catch (error) {
    console.error(
      `${spec.label} failed to start: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
  return report(spec.label, violations, {
    okMessage: spec.okMessage,
    preamble: spec.preamble,
    footer: spec.footer,
  });
}
