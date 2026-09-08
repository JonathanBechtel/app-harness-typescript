/** Complexity and file-size ratchets: the decision tables, pinned. */

import { expect, test } from 'vitest';

import * as complexity from '../../scripts/check-complexity-ratchet.js';
import * as filesize from '../../scripts/check-file-size-ratchet.js';

const T = filesize.THRESHOLD;

test('a count above baseline fails, a count below baseline (stale headroom) also fails, equal passes', () => {
  const baseline = { 'a.ts': { complexity: 2 } };
  expect(complexity.compare({ 'a.ts': { complexity: 3 } }, baseline)).toHaveLength(1);
  expect(complexity.compare({ 'a.ts': { complexity: 1 } }, baseline)).toHaveLength(1);
  expect(complexity.compare({ 'a.ts': { complexity: 2 } }, baseline)).toEqual([]);
  expect(complexity.compare({ 'b.ts': { 'max-params': 1 } }, baseline)).toHaveLength(2);
});

test('the committed baseline equals the measured tree exactly (no drift in either direction)', () => {
  expect(complexity.compare(complexity.measure(), complexity.loadBaseline())).toEqual([]);
});

test('file-size verdicts: under threshold passes, oversized growth fails, shrink passes, new oversized fails, delta cap fails', () => {
  expect(
    filesize.evaluate([{ path: 'app/a.ts', oldLines: 100, newLines: 200 }]).violations,
  ).toEqual([]);
  expect(
    filesize.evaluate([{ path: 'app/big.ts', oldLines: T + 400, newLines: T + 450 }]).violations[0],
  ).toContain('must not grow');
  expect(
    filesize.evaluate([{ path: 'app/big.ts', oldLines: T + 400, newLines: T + 350 }]).violations,
  ).toEqual([]);
  expect(
    filesize.evaluate([{ path: 'app/new.ts', oldLines: 0, newLines: T + 1 }]).violations[0],
  ).toContain('new file');
  expect(
    filesize.evaluate([{ path: 'app/x.ts', oldLines: 10, newLines: 10 + filesize.DELTA_CAP + 1 }])
      .violations[0],
  ).toContain('grew by');
});

test('deleting a 3000-line module and creating three 1000-line ones is a redistribution, not growth', () => {
  const changes = [
    { path: 'app/god.ts', oldLines: 3000, newLines: 0 },
    ...[0, 1, 2].map((i) => ({ path: `app/part${i}.ts`, oldLines: 0, newLines: 1000 })),
  ];
  const { violations, notes } = filesize.evaluate(changes);
  expect(violations).toEqual([]);
  expect(notes).toHaveLength(1);
});

test('a justified file-size waiver exempts an oversized module', () => {
  expect(
    filesize.evaluate([{ path: 'app/big.ts', oldLines: T + 10, newLines: T + 20, waived: true }])
      .violations,
  ).toEqual([]);
});
