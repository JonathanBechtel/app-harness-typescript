/** Versioned prompt discovery: highest wins, env pins, missing families and exports fail loudly. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, expect, test } from 'vitest';

import {
  availableVersions,
  clearCache,
  load,
  PromptNotFoundError,
} from '../../app/ai/prompts/loader.js';

let dir: string;

function writePrompt(family: string, version: string, body: string): void {
  mkdirSync(path.join(dir, family), { recursive: true });
  writeFileSync(path.join(dir, family, `${version}.js`), body);
}

const VALID = (v: string): string =>
  `export const VERSION = '${v}';\nexport const TEMPLATE = 'Hello {name} (${v})';\nexport function render(args) { return TEMPLATE.replace('{name}', String(args.name)); }\n`;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'prompts-'));
  clearCache();
  delete process.env.PROMPT_GREETING_VERSION;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test('versions are discovered by file name and sorted numerically, so v10 follows v9', () => {
  for (const v of ['v1', 'v9', 'v10']) {
    writePrompt('greeting', v, VALID(v));
  }
  expect(availableVersions('greeting', dir)).toEqual(['v1', 'v9', 'v10']);
});

test('load picks the highest version by default and honours PROMPT_<FAMILY>_VERSION or an explicit version', async () => {
  writePrompt('greeting', 'v1', VALID('v1'));
  writePrompt('greeting', 'v2', VALID('v2'));
  expect((await load('greeting', undefined, dir)).VERSION).toBe('v2');
  expect((await load('greeting', 'v1', dir)).render({ name: 'Ada' })).toBe('Hello Ada (v1)');
  process.env.PROMPT_GREETING_VERSION = 'v1';
  clearCache();
  expect((await load('greeting', undefined, dir)).VERSION).toBe('v1');
});

test('an unknown family, an unknown version, or a module missing a required export raises PromptNotFoundError', async () => {
  expect(() => availableVersions('nope', dir)).toThrow(PromptNotFoundError);
  writePrompt('greeting', 'v1', VALID('v1'));
  expect(() => load('greeting', 'v7', dir)).toThrow(/not found; have v1/);
  writePrompt('partial', 'v1', "export const VERSION = 'v1';\n");
  await expect(load('partial', undefined, dir)).rejects.toThrow(/lacks required export TEMPLATE/);
});
