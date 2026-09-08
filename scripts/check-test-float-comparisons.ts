/**
 * Diff-scoped guard: no exact equality against a float literal in changed test assertions.
 *
 * `expect(result).toBe(0.1 + 0.2)` is brittle by construction; `toBeCloseTo`
 * is the house fix. Only assertions on lines this changeset touched are
 * evaluated. Escape hatch: `// discipline: float-compare <reason>` on the line.
 */

import ts from 'typescript';

import { lineOf, parseSource, trailingName, walk } from './_ast.js';
import { diffScopedCli, isMain } from './_check-runner.js';
import { lineHasReasonedWaiver } from './_discipline.js';

const EXACT_MATCHERS = new Set(['toBe', 'toEqual', 'toStrictEqual']);
const ASSERT_EQUALS = new Set(['equal', 'strictEqual', 'deepEqual', 'deepStrictEqual']);

function isFloatLiteral(node: ts.Node | undefined): boolean {
  if (node === undefined) {
    return false;
  }
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    return isFloatLiteral(node.operand);
  }
  return ts.isNumericLiteral(node) && /[.eE]/.test(node.getText());
}

function comparesFloat(call: ts.CallExpression): boolean {
  const name = trailingName(call.expression);
  if (name !== undefined && EXACT_MATCHERS.has(name)) {
    return isFloatLiteral(call.arguments[0]);
  }
  if (name !== undefined && ASSERT_EQUALS.has(name)) {
    return isFloatLiteral(call.arguments[0]) || isFloatLiteral(call.arguments[1]);
  }
  return false;
}

/** Changed assertion lines comparing a float literal exactly. */
export function findViolations(file: string, text: string, changed: ReadonlySet<number>): string[] {
  const source = parseSource(file, text);
  const lines = text.split('\n');
  const out: string[] = [];
  for (const node of walk(source)) {
    if (!ts.isCallExpression(node)) {
      continue;
    }
    const line = lineOf(source, node);
    if (!changed.has(line) || !comparesFloat(node)) {
      continue;
    }
    if (lineHasReasonedWaiver(lines[line - 1] ?? '', 'float-compare')) {
      continue;
    }
    out.push(`${file}:${line}: float equality in assertion; use toBeCloseTo(...)`);
  }
  return out;
}

export function main(argv: readonly string[]): number {
  return diffScopedCli(argv, 'Test float comparisons', findViolations, {
    scope: { pathspec: ['tests'], onlyTests: true },
  });
}

if (isMain(import.meta)) {
  process.exitCode = main(process.argv.slice(2));
}
