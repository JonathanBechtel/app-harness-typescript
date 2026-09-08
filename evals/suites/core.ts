/** Core benchmark suite. Replace example-echo with the app's real datasets. */

import type { Suite } from './index.js';

export const SUITE: Suite = {
  name: 'core',
  datasets: { 'example-echo': 1.0 },
  repetitions: 3,
  minScore: 0.8,
  minDatasetAccuracy: 0.65,
  notes: 'Template placeholder suite; gates are meaningful only once real datasets exist.',
};
