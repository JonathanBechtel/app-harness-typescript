/** Empty-stub, test-title, and float-comparison guards: each fires on its seeded failure. */

import { afterEach, beforeEach, expect, test } from 'vitest';

import * as stubs from '../../scripts/check-empty-method-stubs.js';
import * as floats from '../../scripts/check-test-float-comparisons.js';
import * as titles from '../../scripts/check-test-titles.js';
import { allLines, dedent, Scratch } from './_temp.js';

let scratch: Scratch;
beforeEach(() => {
  scratch = new Scratch('small');
});
afterEach(() => {
  scratch.cleanup();
});

test('an empty method body in a concrete class is EMPTY001; abstract, parameter-property constructors, and commented bodies pass', () => {
  const out = stubs.checkFile(
    scratch.write(
      'stubs.ts',
      `
      abstract class Base { abstract run(): void; protected hook(): void {} }
      class Impl extends Base { run(): void {} }
      class Svc { constructor(private readonly db: unknown) {} tick(): void { /* nothing yet */ } }
    `,
    ),
  );
  expect(out).toHaveLength(2);
  expect(out[0]).toContain('Base.hook has an empty body');
  expect(out[1]).toContain('Impl.run has an empty body');
});

test('a changed test whose title is not a descriptive string is reported; untouched tests are ignored', () => {
  const source = dedent(`
    test('ok', () => {});
    it('renders the landing page with the release sha', () => {});
    test(dynamicTitle, () => {});
    test('short one', () => {});
  `);
  const changed = titles.findViolations('t.test.ts', source, new Set([1, 2, 3]));
  expect(changed).toHaveLength(2);
  expect(changed[0]).toContain('too short');
  expect(changed[1]).toContain('must be a string literal');
  expect(titles.findViolations('t.test.ts', source, allLines(source))).toHaveLength(3);
});

test('exact matchers against a float literal on changed lines are reported; toBeCloseTo and a waiver pass', () => {
  const source = dedent(`
    expect(x).toBe(0.1);
    expect(y).toEqual(-2.5);
    expect(z).toBeCloseTo(0.1);
    expect(w).toBe(3);
    expect(v).toStrictEqual(1e-3); // discipline: float-compare exact constant by construction
    assert.equal(q, 0.2);
  `);
  const out = floats.findViolations('f.test.ts', source, allLines(source));
  expect(out.map((v) => v.split(':')[1])).toEqual(['1', '2', '6']);
  expect(floats.findViolations('f.test.ts', source, new Set([3, 4]))).toEqual([]);
});

test('the repo is clean: no empty stubs under app/ or tests/', () => {
  expect(stubs.checkAll()).toEqual([]);
});
