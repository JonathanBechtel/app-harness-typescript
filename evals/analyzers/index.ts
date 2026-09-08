/** Dataset-agnostic analyzers. */

/** Mean score across repetitions (1.0 = always right). */
export function accuracy(scores: readonly number[]): number {
  return scores.length === 0 ? 0 : scores.reduce((a, b) => a + b, 0) / scores.length;
}

/** 1 - population stddev of scores (1.0 = identical every run). */
export function consistency(scores: readonly number[]): number {
  if (scores.length < 2) {
    return 1;
  }
  const mean = accuracy(scores);
  const variance = scores.reduce((sum, s) => sum + (s - mean) ** 2, 0) / scores.length;
  return 1 - Math.sqrt(variance);
}
