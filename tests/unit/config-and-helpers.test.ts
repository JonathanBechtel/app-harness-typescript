/** Settings parsing edge cases, template filters, and the migration file reader. */

import { expect, test } from 'vitest';

import {
  MIGRATIONS_DIR,
  NO_TRANSACTION_MARKER,
  readRevisions,
  splitStatements,
} from '../../app/cli/migrate.js';
import { isMain } from '../../app/cli/_runner.js';
import { parseSettings, SettingsSchema } from '../../app/config.js';
import { createRootLogger } from '../../app/observability/logger.js';
import { collectSecretValues } from '../../app/observability/scrubbing.js';
import { registerTemplateFilters } from '../../app/web/templating.js';
import { Scratch } from './_temp.js';

test('boolean settings accept 1/true/yes/on and 0/false/no/off in any case, and reject other words', () => {
  expect(parseSettings({ DEBUG: 'YES' }).debug).toBe(true);
  expect(parseSettings({ DEBUG: 'off' }).debug).toBe(false);
  expect(parseSettings({ APP_ENV: 'prod', DEBUG: 'no' }).isProd).toBe(true);
  expect(() => parseSettings({ DEBUG: 'maybe' })).toThrow();
  expect(parseSettings({ ENV: 'stage' }).env).toBe('stage');
  expect(parseSettings({ PORT: '9000' }).port).toBe(9000);
  expect(Object.keys(SettingsSchema.shape)).toContain('databaseUrl');
});

test('a credential that is not a URL contributes only itself to the scrub list', () => {
  const settings = parseSettings({
    SECRET_KEY: 'not-a-url',
    DATABASE_URL: 'postgresql://h/db',
    ANTHROPIC_API_KEY: 'sk-x',
  });
  expect(collectSecretValues(settings)).toEqual(['postgresql://h/db', 'not-a-url', 'sk-x']);
});

test('the iso template filter renders dates without milliseconds and blanks for empty values', () => {
  const filters = new Map<string, (value: unknown) => string>();
  registerTemplateFilters({
    addFilter: (name: string, fn: (value: unknown) => string) => filters.set(name, fn),
  } as never);
  const iso = filters.get('iso');
  expect(iso?.(new Date('2026-01-02T03:04:05.678Z'))).toBe('2026-01-02T03:04:05Z');
  expect(iso?.('2026-01-02T03:04:05Z')).toBe('2026-01-02T03:04:05Z');
  expect(iso?.(null)).toBe('');
  expect(iso?.('')).toBe('');
});

test('the console log format is available in development and still scrubs secrets', () => {
  const lines: string[] = [];
  const logger = createRootLogger({
    level: 'info',
    json: false,
    secrets: ['hunter2'],
    sink: (l) => lines.push(l),
  });
  logger.info('token hunter2 issued');
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain('[REDACTED]');
  expect(lines[0]).not.toContain('hunter2');
});

test('revision files are split on drizzle breakpoints, hashed, ordered by idx, and flagged when marked no-transaction', () => {
  const scratch = new Scratch('journal');
  try {
    scratch.write(
      'meta/_journal.json',
      JSON.stringify({
        entries: [
          { idx: 1, tag: '0001_idx' },
          { idx: 0, tag: '0000_init' },
        ],
      }),
    );
    scratch.write(
      '0000_init.sql',
      'CREATE TABLE t (id int);\n--> statement-breakpoint\nCREATE TABLE u (id int);\n',
    );
    scratch.write(
      '0001_idx.sql',
      `${NO_TRANSACTION_MARKER}\nCREATE INDEX CONCURRENTLY t_idx ON t (id);\n`,
    );
    const revisions = readRevisions(scratch.dir);
    expect(revisions.map((r) => r.tag)).toEqual(['0000_init', '0001_idx']);
    expect(revisions[0]?.statements).toHaveLength(2);
    expect(revisions[0]?.transactional).toBe(true);
    expect(revisions[1]?.transactional).toBe(false);
    expect(revisions[0]?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(splitStatements('  \n--> statement-breakpoint\n')).toEqual([]);
    expect(readRevisions(MIGRATIONS_DIR)).toEqual([]);
  } finally {
    scratch.cleanup();
  }
});

test('isMain is false for a module that was imported rather than executed', () => {
  expect(isMain(import.meta)).toBe(false);
});
