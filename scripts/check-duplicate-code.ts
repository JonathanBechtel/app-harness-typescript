/**
 * Diff-scoped duplicate-code gate over `app/` and `scripts/`.
 *
 * AI-assisted codebases duplicate; eslint and tsc are structurally blind to
 * "this block already exists elsewhere". Runs jscpd over the whole tree (a
 * duplicate is a property of a PAIR of files), then intersects each finding's
 * line range with the lines this changeset added or modified. Fails when
 * `duplicated changed lines / changed lines` exceeds `DUPLICATE_CODE_MAX_PERCENT`
 * (default 3.0). A zero denominator passes; a tiny diff needs at least
 * `MIN_CHANGED_LINES` before the percentage counts.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  againstArg,
  changedLineNumbers,
  displayPath,
  isMain,
  REPO,
  report,
} from './_check-runner.js';

const SCOPES = ['app', 'scripts'];
export const MIN_SIMILARITY_LINES = 8;
export const MIN_CHANGED_LINES = 20;

interface JscpdFile {
  name: string;
  start: number;
  end: number;
}
interface JscpdReport {
  duplicates?: { firstFile: JscpdFile; secondFile: JscpdFile }[];
}

/** jscpd's duplicate report over every .ts file in scope. */
export function runJscpd(): JscpdReport {
  const out = mkdtempSync(path.join(tmpdir(), 'jscpd-'));
  try {
    const bin = path.join(REPO, 'node_modules', 'jscpd', 'run-jscpd.js');
    const result = spawnSync(
      process.execPath,
      [
        bin,
        '--min-lines',
        String(MIN_SIMILARITY_LINES),
        '--reporters',
        'json',
        '--output',
        out,
        '--format',
        'typescript',
        '--absolute',
        ...SCOPES,
      ],
      { cwd: REPO, encoding: 'utf8' },
    );
    if (result.status !== 0) {
      throw new Error(
        `jscpd failed (${result.status ?? 'signal'}): ${result.stderr.trim().slice(0, 500)}`,
      );
    }
    const reportPath = path.join(out, 'jscpd-report.json');
    return existsSync(reportPath)
      ? (JSON.parse(readFileSync(reportPath, 'utf8')) as JscpdReport)
      : {};
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

/** Line numbers jscpd reports as duplicated, per repo-relative file. */
export function duplicatedRanges(jscpd: JscpdReport): Map<string, Set<number>> {
  const ranges = new Map<string, Set<number>>();
  for (const dup of jscpd.duplicates ?? []) {
    for (const side of [dup.firstFile, dup.secondFile]) {
      const file = displayPath(path.resolve(REPO, side.name));
      const lines = ranges.get(file) ?? new Set<number>();
      for (let n = side.start; n <= side.end; n += 1) {
        lines.add(n);
      }
      ranges.set(file, lines);
    }
  }
  return ranges;
}

/** Return (percent, dupLines, changedLines, offending files). */
export function evaluate(
  changed: ReadonlyMap<string, ReadonlySet<number>>,
  duplicated: ReadonlyMap<string, ReadonlySet<number>>,
): { percent: number; dup: number; total: number; offenders: string[] } {
  let total = 0;
  let dup = 0;
  const offenders: string[] = [];
  for (const [file, lines] of changed) {
    total += lines.size;
    const hits = [...lines].filter((n) => duplicated.get(file)?.has(n) === true);
    if (hits.length > 0) {
      dup += hits.length;
      offenders.push(
        `${file}: ${hits.length} duplicated changed line(s) (lines ${Math.min(...hits)}-${Math.max(...hits)})`,
      );
    }
  }
  return { percent: total === 0 ? 0 : (dup / total) * 100, dup, total, offenders };
}

export function main(argv: readonly string[]): number {
  const maxPercent = Number(process.env.DUPLICATE_CODE_MAX_PERCENT ?? '3.0');
  const changed = new Map(
    [...changedLineNumbers(againstArg(argv), SCOPES)].filter(([file]) => file.endsWith('.ts')),
  );
  const totalChanged = [...changed.values()].reduce((s, lines) => s + lines.size, 0);
  if (totalChanged < MIN_CHANGED_LINES) {
    console.log(
      `duplicate-code: ${totalChanged} changed lines in scope (< ${MIN_CHANGED_LINES}); skipping`,
    );
    return 0;
  }
  const { percent, dup, total, offenders } = evaluate(changed, duplicatedRanges(runJscpd()));
  const summary = `duplicate-code: ${dup}/${total} changed lines duplicated (${percent.toFixed(1)}%, max ${maxPercent}%)`;
  if (percent <= maxPercent) {
    console.log(summary);
    return 0;
  }
  return report('Duplicate-code gate', [summary, ...offenders], {
    footer: 'Extract the shared helper instead of copying it.',
  });
}

if (isMain(import.meta)) {
  process.exitCode = main(process.argv.slice(2));
}
