/** Model ids live in config and the role registry only. */

import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from 'vitest';

import { resolve } from '../../app/ai/registry.js';
import { parseSettings, REPO_ROOT } from '../../app/config.js';

const MODEL_ID = /["'](claude-[a-z0-9.-]+|gpt-[a-z0-9.-]+|gemini-[a-z0-9.-]+)["']/;
const ALLOWED = new Set(['app/config.ts']);

test('any literal model id under app/ outside app/config.ts fails; use roles via app/ai/registry', () => {
  const offenders: string[] = [];
  for (const rel of globSync('app/**/*.ts', { cwd: REPO_ROOT })) {
    const posix = rel.split(path.sep).join('/');
    if (ALLOWED.has(posix)) {
      continue;
    }
    readFileSync(path.join(REPO_ROOT, rel), 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (MODEL_ID.test(line)) {
          offenders.push(`${posix}:${i + 1}`);
        }
      });
  }
  expect(offenders, 'hard-coded model ids').toEqual([]);
});

test('a role without overrides uses the configured defaults and AI_<ROLE>_* env vars override it', () => {
  const settings = parseSettings({
    AI_DEFAULT_PROVIDER: 'anthropic',
    AI_DEFAULT_MODEL: 'default-model',
  });
  expect(resolve('summarizer', settings, {}).model).toBe('default-model');
  const choice = resolve('summarizer', settings, {
    AI_SUMMARIZER_MODEL: 'other-model',
    AI_SUMMARIZER_PROVIDER: 'other',
  });
  expect([choice.provider, choice.model]).toEqual(['other', 'other-model']);
  expect(resolve('long-form', settings, { AI_LONG_FORM_MODEL: 'lf' }).model).toBe('lf');
});
