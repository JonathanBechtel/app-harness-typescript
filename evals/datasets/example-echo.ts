/**
 * Illustrative dataset: replace with real questions grounded in real data.
 *
 * Kept minimal so the harness is exercisable without credentials.
 */

import type { Question } from './index.js';

export const QUESTIONS: readonly Question[] = [
  { id: 'echo-1', question: 'ping', expected: 'echo: ping' },
  { id: 'echo-2', question: '2024-01-15 report', expected: 'echo: 2024-01-15 report' },
];

/** Exact-match scoring; real datasets usually normalise or extract first. */
export function score(answer: string, expected: string): number {
  return answer.trim() === expected.trim() ? 1 : 0;
}
