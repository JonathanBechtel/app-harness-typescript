/**
 * Per-test fixtures over the run's isolated schema.
 *
 * - `db` / `sql`: committed connections into the schema; every table is truncated
 *   after the test (HTTP-client, concurrency and durability tests need real commits).
 * - `tx`: a transaction that is rolled back after the test (the default for
 *   service/repository tests: fast, no cleanup).
 * - `appClient`: the Fastify app built over `db`, driven with `app.inject()`.
 * - `statements`: every SQL statement issued through `sql` during the test,
 *   for the query-count budgets in perf/.
 */

import type { Sql } from 'postgres';
import { inject, test as base } from 'vitest';

import { type App, buildApp } from '../../app/app.js';
import { createDbClient, type Db, type Tx } from '../../app/utils/db.js';

class Rollback extends Error {}

interface Fixtures {
  statements: string[];
  sql: Sql;
  db: Db;
  tx: Tx;
  appClient: App;
}

async function truncateAll(sql: Sql, schema: string): Promise<void> {
  const rows = await sql<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname = ${schema}`;
  const tables = rows
    .map((r) => `"${schema}"."${r.tablename}"`)
    .filter((t) => !t.includes('__app_migrations'));
  if (tables.length > 0) {
    await sql.unsafe(`TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
  }
}

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern -- vitest fixtures destructure their dependencies
  statements: async ({}, use) => {
    await use([]);
  },
  sql: async ({ statements }, use) => {
    const schema = inject('testSchema');
    const client = createDbClient(inject('testDatabaseUrl'), {
      max: 2,
      connection: { search_path: `"${schema}"` },
      debug: (_connection, query) => {
        // Connection setup (SET/SHOW, the driver's one-time pg_catalog type fetch) is not request cost.
        if (!/^\s*(SET|SHOW)\b/i.test(query) && !query.includes('pg_catalog.pg_type')) {
          statements.push(query);
        }
      },
    });
    try {
      await use(client.sql);
    } finally {
      await truncateAll(client.sql, schema);
      await client.sql.end({ timeout: 5 });
    }
  },
  db: async ({ sql }, use) => {
    const { drizzle } = await import('drizzle-orm/postgres-js');
    const schema = await import('../../app/models/index.js');
    await use(drizzle(sql, { schema }));
  },
  tx: async ({ db }, use) => {
    await db
      .transaction(async (t) => {
        await use(t);
        throw new Rollback();
      })
      .catch((error: unknown) => {
        if (!(error instanceof Rollback)) {
          throw error;
        }
      });
  },
  appClient: async ({ db }, use) => {
    const app = await buildApp({ db });
    try {
      await app.ready();
      await use(app);
    } finally {
      await app.close();
    }
  },
});

export { expect } from 'vitest';
export { inject };
