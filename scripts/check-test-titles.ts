/**
 * Diff-scoped guard: changed tests must carry a descriptive title.
 *
 * CLAUDE.md asks every test to name the behaviour under test and the expected
 * outcome, so a failure is interpretable by whoever sees it next. Without
 * enforcement that runs on the honour system and drifts. Diff-scoped at LINE
 * granularity: only a `test(...)` / `it(...)` whose span overlaps lines this
 * changeset added or modified is evaluated, so existing tests are never
 * retrofitted wholesale. A title is a literal string of at least MIN_WORDS words.
 *
 * Usage:
 *
 *     tsx scripts/check-test-titles.ts                      # vs HEAD
 *     tsx scripts/check-test-titles.ts --against origin/main
 */

import ts from 'typescript';

import { endLineOf, lineOf, parseSource, rootName, stringValue, walk } from './_ast.js';
import { diffScopedCli, isMain } from './_check-runner.js';

export const MIN_WORDS = 4;
const TEST_FUNCTIONS = new Set(['test', 'it']);

function isTestCall(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) {
    return false;
  }
  const callee = node.expression;
  if (ts.isIdentifier(callee)) {
    return TEST_FUNCTIONS.has(callee.text);
  }
  if (ts.isPropertyAccessExpression(callee)) {
    const root = rootName(callee);
    return root !== undefined && TEST_FUNCTIONS.has(root) && callee.name.text !== 'each';
  }
  return false;
}

/** Changed test calls in `source` whose title is missing or too short. */
export function findViolations(file: string, text: string, changed: ReadonlySet<number>): string[] {
  const source = parseSource(file, text);
  const out: string[] = [];
  for (const node of walk(source)) {
    if (!isTestCall(node)) {
      continue;
    }
    const first = lineOf(source, node);
    const last = endLineOf(source, node);
    let touched = false;
    for (let n = first; n <= last && !touched; n += 1) {
      touched = changed.has(n);
    }
    if (!touched) {
      continue;
    }
    const title = stringValue(node.arguments[0]);
    const words =
      title === undefined
        ? 0
        : title
            .trim()
            .split(/\s+/)
            .filter((w) => w !== '').length;
    if (title === undefined) {
      out.push(
        `${file}:${first}: test title must be a string literal describing the behaviour (changed in this diff)`,
      );
    } else if (words < MIN_WORDS) {
      out.push(
        `${file}:${first}: test title "${title}" is too short; name the behaviour and the expected outcome (>= ${MIN_WORDS} words)`,
      );
    }
  }
  return out;
}

export function main(argv: readonly string[]): number {
  return diffScopedCli(argv, 'Test titles', findViolations, {
    scope: { pathspec: ['tests'], onlyTests: true },
    footer: 'Title each test with the behaviour under test and the expected outcome (CLAUDE.md).',
  });
}

if (isMain(import.meta)) {
  process.exitCode = main(process.argv.slice(2));
}
