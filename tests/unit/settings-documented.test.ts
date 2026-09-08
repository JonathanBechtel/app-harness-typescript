/** Reflective guards over Settings: every field documented, every secret scrubbed. */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from 'vitest';

import { envName, parseSettings, REPO_ROOT, SETTING_KEYS } from '../../app/config.js';
import { collectSecretValues, SECRET_SETTING_FIELDS } from '../../app/observability/scrubbing.js';

const CREDENTIAL_SHAPE = /(Key|Secret|Token|Password|Url)$/;

test('each Settings field appears as its env var name in .env.example so operators can find it', () => {
  const example = readFileSync(path.join(REPO_ROOT, '.env.example'), 'utf8');
  const missing = SETTING_KEYS.map(envName).filter((name) => !example.includes(name));
  expect(missing, 'document these in .env.example').toEqual([]);
});

test('a field named like a credential must be in SECRET_SETTING_FIELDS or logs can leak it', () => {
  const credentialLike = SETTING_KEYS.filter((k) => CREDENTIAL_SHAPE.test(k));
  const unscrubbed = credentialLike.filter(
    (k) => !(SECRET_SETTING_FIELDS as readonly string[]).includes(k),
  );
  expect(unscrubbed, 'add to SECRET_SETTING_FIELDS').toEqual([]);
});

test('a stale entry in SECRET_SETTING_FIELDS is an error, not a shrug', () => {
  const stale = SECRET_SETTING_FIELDS.filter(
    (f) => !(SETTING_KEYS as readonly string[]).includes(f),
  );
  expect(stale).toEqual([]);
});

test('the database password is scrubbed on its own, since error strings carry it without the URL', () => {
  const settings = parseSettings({
    DATABASE_URL: 'postgresql://u:hunter2@h/db',
    SECRET_KEY: 's3cr3t',
  });
  const values = collectSecretValues(settings);
  expect(values).toContain('hunter2');
  expect(values).toContain('s3cr3t');
  expect(values[0]).toBe('postgresql://u:hunter2@h/db'); // longest first
});

test('env var names derive mechanically from setting keys and APP_ENV is the alias of env', () => {
  expect(envName('dbPoolSize')).toBe('DB_POOL_SIZE');
  expect(envName('env')).toBe('APP_ENV');
  expect(parseSettings({ APP_ENV: 'prod', LOG_JSON: '' }).jsonLogs).toBe(true);
  expect(parseSettings({ APP_ENV: 'dev', LOG_JSON: '1' }).jsonLogs).toBe(true);
  expect(parseSettings({ APP_ENV: 'dev' }).isDev).toBe(true);
});
