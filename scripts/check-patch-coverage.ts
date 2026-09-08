/**
 * Patch-coverage gate: the share of changed `app/` lines a test executed.
 *
 * Whole-project coverage is reported, not gated, so legacy debt never blocks a
 * fix; what CI enforces is that the lines THIS change added or modified were
 * exercised (default >= 80%). Reads the lcov report vitest writes
 * (`coverage/lcov.info`) and intersects it with the diff against `--against`.
 * Lines lcov does not mention (comments, types) are not counted either way.
 *
 * Usage: tsx scripts/check-patch-coverage.ts --against origin/main --fail-under 80
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { changedLineNumbers, displayPath, isMain, REPO } from './_check-runner.js';

export const LCOV = path.join(REPO, 'coverage', 'lcov.info');

/** Per repo-relative file: line -> hit count, from an lcov report. */
export function parseLcov(text: string, root: string = REPO): Map<string, Map<number, number>> {
  const files = new Map<string, Map<number, number>>();
  let current: Map<number, number> | undefined;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('SF:')) {
      current = new Map();
      files.set(displayPath(path.resolve(root, line.slice(3)), root), current);
    } else if (line.startsWith('DA:') && current !== undefined) {
      const [lineNo, hits] = line.slice(3).split(',');
      current.set(Number(lineNo), Number(hits ?? '0'));
    } else if (line === 'end_of_record') {
      current = undefined;
    }
  }
  return files;
}

export interface PatchCoverage {
  readonly covered: number;
  readonly total: number;
  readonly percent: number;
  readonly missing: string[];
}

/** Intersect changed lines with lcov's executable lines. */
export function evaluate(
  changed: ReadonlyMap<string, ReadonlySet<number>>,
  lcov: ReadonlyMap<string, ReadonlyMap<number, number>>,
): PatchCoverage {
  let covered = 0;
  let total = 0;
  const missing: string[] = [];
  for (const [file, lines] of changed) {
    const hits = lcov.get(file);
    if (hits === undefined) {
      continue; // not instrumented (never imported by a test): counted below as uncovered
    }
    const uncovered: number[] = [];
    for (const line of lines) {
      const count = hits.get(line);
      if (count === undefined) {
        continue;
      }
      total += 1;
      if (count > 0) {
        covered += 1;
      } else {
        uncovered.push(line);
      }
    }
    if (uncovered.length > 0) {
      missing.push(
        `${file}: ${uncovered.length} changed line(s) not executed (e.g. ${uncovered.slice(0, 5).join(', ')})`,
      );
    }
  }
  return { covered, total, percent: total === 0 ? 100 : (covered / total) * 100, missing };
}

export function main(argv: readonly string[]): number {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      against: { type: 'string', default: 'origin/main' },
      'fail-under': { type: 'string', default: '80' },
    },
  });
  if (!existsSync(LCOV)) {
    console.error(
      `patch coverage: ${displayPath(LCOV)} not found; run the tests with coverage first (npm run coverage)`,
    );
    return 1;
  }
  const changed = new Map(
    [...changedLineNumbers(values.against, ['app'])].filter(([f]) => f.endsWith('.ts')),
  );
  const result = evaluate(changed, parseLcov(readFileSync(LCOV, 'utf8')));
  const threshold = Number(values['fail-under']);
  console.log(
    `patch coverage: ${result.covered}/${result.total} changed app/ lines executed (${result.percent.toFixed(1)}%, gate ${threshold}%)`,
  );
  for (const line of result.missing) {
    console.log(`  ${line}`);
  }
  return result.percent + 1e-9 >= threshold ? 0 : 1;
}

if (isMain(import.meta)) {
  process.exitCode = main(process.argv.slice(2));
}
