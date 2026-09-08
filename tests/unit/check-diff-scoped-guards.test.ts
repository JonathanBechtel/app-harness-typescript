/** The shared diff machinery: changed lines, untracked files, and the empty-tree fallback. */

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, expect, test } from 'vitest';

import {
  changedLineNumbers,
  EMPTY_TREE,
  mergeBase,
  parseArgs,
} from '../../scripts/_check-runner.js';
import { Scratch } from './_temp.js';

let scratch: Scratch;
const git = (...args: string[]): void => {
  const result = spawnSync('git', args, { cwd: scratch.dir, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr);
  }
};

beforeEach(() => {
  scratch = new Scratch('diff');
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'T');
});
afterEach(() => {
  scratch.cleanup();
});

test('changed line numbers cover modified and added lines plus every line of an untracked file', () => {
  const file = scratch.write('tests/a.test.ts', 'one\ntwo\nthree\n');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  writeFileSync(file, 'one\nTWO\nthree\nfour\n');
  scratch.write('tests/b.test.ts', 'x\ny\n');
  const changed = changedLineNumbers('HEAD', ['tests'], scratch.dir);
  expect([...(changed.get('tests/a.test.ts') ?? [])].sort()).toEqual([2, 4]);
  expect([...(changed.get('tests/b.test.ts') ?? [])].sort()).toEqual([1, 2]);
});

test('an unknown base ref (first push, all-zero sha) diffs against the empty tree instead of crashing', () => {
  scratch.write('x.ts', 'a\n');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  expect(mergeBase('0000000000000000000000000000000000000000', scratch.dir)).toBe(EMPTY_TREE);
  expect(mergeBase('HEAD', scratch.dir)).toHaveLength(40);
  expect(
    changedLineNumbers('0000000000000000000000000000000000000000', [], scratch.dir).get('x.ts')
      ?.size,
  ).toBe(1);
});

test('a path-taking checker refuses to run with neither paths nor --all and rejects unknown options', () => {
  expect(() => parseArgs(['check-x.ts'])).toThrow(/refusing to report OK after checking nothing/);
  expect(() => parseArgs(['check-x.ts', '--verbose'])).toThrow(/unknown option/);
  expect(parseArgs(['check-x.ts', '--all'])).toEqual({ scanAll: true, paths: [] });
  expect(parseArgs(['check-x.ts', path.join('a', 'b.ts')]).paths).toEqual([path.join('a', 'b.ts')]);
});
