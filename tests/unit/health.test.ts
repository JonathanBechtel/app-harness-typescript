/** Liveness probe behaviour, without a database. */

import { afterAll, beforeAll, expect, test } from 'vitest';

import { type App, buildApp } from '../../app/app.js';
import { settings } from '../../app/config.js';
import { REQUEST_ID_HEADER } from '../../app/observability/middleware.js';

let app: App;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

test('GET /health returns ok, the environment, and the release sha with no database access', async () => {
  const response = await app.inject({ method: 'GET', url: '/health' });
  expect(response.statusCode).toBe(200);
  const body = response.json<{ status: string; env: string; releaseSha: string }>();
  expect(body.status).toBe('ok');
  expect(body.env).toBe(settings.env); // CI runs as stage, local as dev
  expect(body.releaseSha).toBe('testsha0000');
});

test('a safe inbound X-Request-ID is echoed and an unsafe one is replaced with a fresh id', async () => {
  const echoed = await app.inject({
    method: 'GET',
    url: '/health',
    headers: { [REQUEST_ID_HEADER]: 'abc-123' },
  });
  expect(echoed.headers[REQUEST_ID_HEADER]).toBe('abc-123');
  const replaced = await app.inject({
    method: 'GET',
    url: '/health',
    headers: { [REQUEST_ID_HEADER]: 'bad value!' },
  });
  expect(replaced.headers[REQUEST_ID_HEADER]).not.toBe('bad value!');
  expect(replaced.headers[REQUEST_ID_HEADER]).toHaveLength(32);
});

test('GET /health/db reports 503 unavailable when the database cannot answer', async () => {
  const response = await app.inject({ method: 'GET', url: '/health/db' });
  expect(response.statusCode).toBe(503);
  const body = response.json<{ status: string; databaseOk: boolean; error: string | null }>();
  expect(body.status).toBe('unavailable');
  expect(body.databaseOk).toBe(false);
  expect(body.error).toContain('unit tests must not connect');
});

test('the optional web layer serves the placeholder page through the shared base template', async () => {
  const response = await app.inject({ method: 'GET', url: '/' });
  expect(response.statusCode).toBe(200);
  expect(response.headers['content-type']).toContain('text/html');
  expect(response.body).toContain('data-testid="landing"');
  expect(response.body).toContain('/static/css/main.css');
});
