/** The eval runner scores repetitions, weights datasets, and applies the suite gates. */

import { expect, test } from 'vitest';

import { accuracy, consistency } from '../../evals/analyzers/index.js';
import { runSuite } from '../../evals/runner.js';

test('accuracy is the mean score and consistency is one minus the population stddev', () => {
  expect(accuracy([1, 0, 1, 0])).toBeCloseTo(0.5);
  expect(consistency([1, 1, 1])).toBeCloseTo(1);
  expect(consistency([1, 0])).toBeCloseTo(0.5);
  expect(accuracy([])).toBe(0);
});

test('the core suite passes with the echo responder and fails its gates with a wrong one', async () => {
  const good = await runSuite('core', 2, (q) => Promise.resolve(`echo: ${q}`));
  expect(good.passed).toBe(true);
  expect(good.score).toBe(1);
  expect(good.datasets[0]?.questions).toHaveLength(2);
  const bad = await runSuite('core', 1, () => Promise.resolve('nope'));
  expect(bad.passed).toBe(false);
  expect(bad.failedDatasets).toEqual(['example-echo']);
});
