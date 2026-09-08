/** Patch-coverage and duplicate-code arithmetic, pinned. */

import { expect, test } from 'vitest';

import * as dup from '../../scripts/check-duplicate-code.js';
import * as patch from '../../scripts/check-patch-coverage.js';

test('lcov is parsed per file and patch coverage counts only changed executable lines', () => {
  const lcov =
    'TN:\nSF:app/services/a-service.ts\nDA:1,1\nDA:2,0\nDA:3,4\nend_of_record\nSF:/abs/root/app/b.ts\nDA:1,0\nend_of_record\n';
  const parsed = patch.parseLcov(lcov, '/abs/root');
  expect([...parsed.keys()]).toEqual(['app/services/a-service.ts', 'app/b.ts']);
  const result = patch.evaluate(
    new Map([['app/services/a-service.ts', new Set([1, 2, 3, 99])]]),
    parsed,
  );
  expect(result.covered).toBe(2);
  expect(result.total).toBe(3);
  expect(result.percent).toBeCloseTo(66.67, 1);
  expect(result.missing[0]).toContain('1 changed line(s) not executed');
  expect(patch.evaluate(new Map(), parsed).percent).toBe(100);
});

test('duplicate ranges from jscpd are intersected with changed lines and reported as a percentage', () => {
  const ranges = dup.duplicatedRanges({
    duplicates: [
      {
        firstFile: { name: 'app/a.ts', start: 10, end: 12 },
        secondFile: { name: 'scripts/b.ts', start: 1, end: 3 },
      },
    ],
  });
  expect([...(ranges.get('app/a.ts') ?? [])]).toEqual([10, 11, 12]);
  const result = dup.evaluate(new Map([['app/a.ts', new Set([9, 10, 11, 20])]]), ranges);
  expect(result.dup).toBe(2);
  expect(result.total).toBe(4);
  expect(result.percent).toBeCloseTo(50);
  expect(result.offenders[0]).toContain('lines 10-11');
});
