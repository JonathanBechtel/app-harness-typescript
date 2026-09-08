/**
 * Diff-scoped file-size ratchet for `app/` modules.
 *
 * Failure this descends from: service files past 5,000 lines, and a merge of
 * 35,000 insertions -- complexity beyond a reviewable unit. An absolute limit
 * would be ignored or a permanent wall of noise, so the rule measures the CHANGE
 * against a base ref:
 *
 *     Ends under THRESHOLD                     pass
 *     Already over and the change grows it     fail
 *     Already over and the change shrinks it   pass
 *     New file over THRESHOLD                  fail
 *     Grew by more than DELTA_CAP              fail
 *
 * Do not block the decomposition this rule exists to encourage: a pure split
 * creates new files full of moved lines. Rename detection (`git diff -M -C`)
 * and net-change evaluation across the whole changeset make a redistribution
 * pass; deleted files offset creation (capped at lines added in new files) but
 * never the growth of a file that already existed.
 *
 * Escape hatch: a `// discipline: file-size <reason>` comment in the file.
 * lint-staged runs this in warn mode; CI passes `--enforce` against the PR base,
 * and enforce mode fails closed on git errors.
 */

import path from 'node:path';

import {
  againstArg,
  displayPath,
  git,
  GitError,
  gitTrackedFiles,
  isFile,
  isMain,
  mergeBase,
  readText,
  REPO,
  report,
  untrackedFiles,
} from './_check-runner.js';
import { textHasReasonedWaiver } from './_discipline.js';

export const THRESHOLD = 500;
export const DELTA_CAP = 300;
export const RULE = 'file-size';
const SCOPE = 'app/';

export interface FileChange {
  readonly path: string;
  readonly oldLines: number;
  readonly newLines: number;
  readonly waived?: boolean;
}

const isNew = (c: FileChange): boolean => c.oldLines === 0;
const isDeleted = (c: FileChange): boolean => c.newLines === 0 && c.oldLines > 0;

function countLines(text: string): number {
  return text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}

function lineCountAt(ref: string | undefined, file: string): number {
  if (ref === undefined) {
    const full = path.join(REPO, file);
    return isFile(full) ? countLines(readText(full)) : 0;
  }
  const shown = git(['show', `${ref}:${file}`], { check: false });
  return countLines(shown);
}

function splitPaths(status: string, paths: readonly string[]): [string, string] {
  const first = paths[0] ?? '';
  if (status.startsWith('R') || status.startsWith('C')) {
    return [first, paths[1] ?? ''];
  }
  if (status === 'D') {
    return [first, ''];
  }
  return [status === 'A' ? '' : first, first];
}

function changeFor(status: string, paths: readonly string[], base: string): FileChange | undefined {
  const last = paths.at(-1);
  if (!last?.endsWith('.ts')) {
    return undefined;
  }
  const [oldPath, newPath] = splitPaths(status, paths);
  const oldLines = oldPath === '' ? 0 : lineCountAt(base, oldPath);
  const newLines = newPath === '' ? 0 : lineCountAt(undefined, newPath);
  const full = path.join(REPO, newPath);
  const text = newPath !== '' && isFile(full) ? readText(full) : '';
  return {
    path: newPath === '' ? oldPath : newPath,
    oldLines,
    newLines,
    waived: textHasReasonedWaiver(text, RULE),
  };
}

/** Changed `app/**\/*.ts` files between the merge base and the working tree. */
export function collectChanges(against: string): FileChange[] {
  const base = mergeBase(against);
  const out = git(['diff', '-M', '-C', '--name-status', base, '--', SCOPE]);
  const changes: FileChange[] = [];
  for (const line of out.split('\n')) {
    if (line === '') {
      continue;
    }
    const [status = '', ...paths] = line.split('\t');
    const change = changeFor(status, paths, base);
    if (change !== undefined) {
      changes.push(change);
    }
  }
  for (const file of untrackedFiles([SCOPE])) {
    const full = path.join(REPO, file);
    if (file.endsWith('.ts') && isFile(full)) {
      const text = readText(full);
      changes.push({
        path: file,
        oldLines: 0,
        newLines: countLines(text),
        waived: textHasReasonedWaiver(text, RULE),
      });
    }
  }
  return changes;
}

function verdictFor(c: FileChange): string | undefined {
  if (isDeleted(c) || c.waived === true) {
    return undefined;
  }
  if (isNew(c) && c.newLines > THRESHOLD) {
    return `${c.path}: new file is ${c.newLines} lines (> ${THRESHOLD}); start it decomposed`;
  }
  if (c.newLines > THRESHOLD && c.newLines > c.oldLines) {
    return `${c.path}: over ${THRESHOLD} lines and must not grow (${c.oldLines} -> ${c.newLines})`;
  }
  if (!isNew(c) && c.newLines - c.oldLines > DELTA_CAP) {
    return `${c.path}: grew by ${c.newLines - c.oldLines} lines in one change (cap ${DELTA_CAP}); split it`;
  }
  return undefined;
}

/** Return (violations, notes) for a changeset. */
export function evaluate(changes: readonly FileChange[]): {
  violations: string[];
  notes: string[];
} {
  const created = changes.filter(isNew).reduce((s, c) => s + c.newLines, 0);
  const deleted = changes.filter(isDeleted).reduce((s, c) => s + c.oldLines, 0);
  const net =
    changes.filter((c) => !isDeleted(c)).reduce((s, c) => s + c.newLines - c.oldLines, 0) -
    Math.min(deleted, created);
  if (net <= 0 && changes.some((c) => c.newLines > THRESHOLD)) {
    return {
      violations: [],
      notes: [
        `net change ${net >= 0 ? '+' : ''}${net} lines across the changeset: redistribution, not growth`,
      ],
    };
  }
  const violations = changes.map(verdictFor).filter((v): v is string => v !== undefined);
  return { violations, notes: [] };
}

/** Every app/ file carrying a justified waiver and its size. */
export function waiverReport(): Record<string, number> {
  const result: Record<string, number> = {};
  for (const file of gitTrackedFiles(/^app\//)) {
    const text = readText(path.join(REPO, file));
    if (textHasReasonedWaiver(text, RULE)) {
      result[displayPath(file)] = countLines(text);
    }
  }
  return result;
}

export function main(argv: readonly string[]): number {
  const enforce = argv.includes('--enforce');
  if (argv.includes('--report')) {
    console.log(JSON.stringify(waiverReport(), null, 2));
    return 0;
  }
  let changes: FileChange[];
  try {
    changes = collectChanges(againstArg(argv));
  } catch (error) {
    if (!(error instanceof GitError)) {
      throw error;
    }
    console.error(`file-size ratchet: git failed: ${error.message}`);
    return enforce ? 1 : 0;
  }
  const { violations, notes } = evaluate(changes);
  for (const note of notes) {
    console.log(`file-size ratchet: ${note}`);
  }
  if (!enforce && violations.length > 0) {
    console.error('file-size ratchet (warning; CI enforces):\n  ' + violations.join('\n  '));
    return 0;
  }
  return report('File-size ratchet', violations, {
    footer: `Decompose the module, or waive with \`// discipline: ${RULE} <reason>\`.`,
  });
}

if (isMain(import.meta)) {
  process.exitCode = main(process.argv.slice(2));
}
