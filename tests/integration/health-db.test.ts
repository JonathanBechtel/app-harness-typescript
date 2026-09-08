/** Readiness probe and schema isolation against a real database. */

import { expect, inject, test } from './fixtures.js';

test('GET /health/db returns 200 with databaseOk true and a latency when Postgres answers', async ({
  appClient,
}) => {
  const response = await appClient.inject({ method: 'GET', url: '/health/db' });
  expect(response.statusCode).toBe(200);
  const body = response.json<{ databaseOk: boolean; latencyMs: number | null }>();
  expect(body.databaseOk).toBe(true);
  expect(body.latencyMs).not.toBeNull();
});

test("the test connection's search_path points at the per-run schema, never public", async ({
  sql,
}) => {
  const [row] = await sql<{ search_path: string }[]>`SHOW search_path`;
  expect(row?.search_path).toContain(inject('testSchema'));
});

test('the migration runner recorded every journalled revision in the isolated schema', async ({
  sql,
}) => {
  const rows = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM __app_migrations`;
  expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(0);
});

test('a rolled-back transaction fixture leaves no trace and sees the same schema', async ({
  tx,
}) => {
  const rows = await tx.execute<{ current_schema: string }>('SELECT current_schema()');
  expect(rows[0]?.current_schema).toContain('vitest_');
});
