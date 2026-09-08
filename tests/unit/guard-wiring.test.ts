/**
 * Every guard script is wired in all three places: tasks.ts, lint-staged, CI.
 *
 * A guard that runs in one place but not another is exactly how "passes locally,
 * fails in CI" (or the reverse) happens.
 */

import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from 'vitest';

import { REPO_ROOT } from '../../app/config.js';
import { TASKS } from '../../tasks.js';

// Scripts run indirectly (by the round-trip task, the coverage task, or the scheduled monitor).
const INDIRECT = new Set([
  'check-migration-drift.ts',
  'check-deploy-freshness.ts',
  'check-patch-coverage.ts',
]);

const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const guardScripts = (): string[] =>
  globSync('scripts/check-*.ts', { cwd: REPO_ROOT })
    .map((p) => path.basename(p))
    .filter((name) => !INDIRECT.has(name))
    .sort();

test('each scripts/check-*.ts appears in lint-staged.config.js, tasks.ts, and ci.yml (directly or via npm run checks)', () => {
  const lintStaged = read('lint-staged.config.js');
  const tasks = read('tasks.ts');
  const ci = read('.github/workflows/ci.yml');
  const missing: string[] = [];
  for (const script of guardScripts()) {
    const stem = script.replace(/\.ts$/, '');
    if (!lintStaged.includes(script)) {
      missing.push(`${script} not in lint-staged.config.js`);
    }
    if (!tasks.includes(stem)) {
      missing.push(`${script} not in tasks.ts`);
    }
    if (!ci.includes(script) && !ci.includes('npm run checks')) {
      missing.push(`${script} not in ci.yml`);
    }
  }
  expect(missing).toEqual([]);
});

test('every lint-staged entry runs at least one command and the hook table is not trivially small', async () => {
  const config = (await import('../../lint-staged.config.js')) as {
    default: Record<string, unknown[]>;
  };
  const entries = Object.entries(config.default);
  expect(entries.length).toBeGreaterThanOrEqual(10);
  for (const [glob, commands] of entries) {
    expect(commands.length, glob).toBeGreaterThan(0);
  }
});

test('package.json exposes every tasks.ts task as an npm script and nothing else', () => {
  const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;
  const expected = new Map([...TASKS.keys()].map((name) => [name, `tsx tasks.ts ${name}`]));
  expected.set('prepare', 'husky || true');
  expect(scripts).toEqual(Object.fromEntries(expected));
});
