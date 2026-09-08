/** The migration runner against a real database: idempotent, per-revision, records what it applied. */

import { main as healthcheck } from '../../app/cli/healthcheck.js';
import {
  migrate,
  MIGRATIONS_TABLE,
  NO_TRANSACTION_MARKER,
  pending,
} from '../../app/cli/migrate.js';
import { Scratch } from '../unit/_temp.js';
import { expect, test } from './fixtures.js';

test('migrate applies pending revisions once, in order, including a no-transaction revision, and is a no-op afterwards', async ({
  sql,
}) => {
  const scratch = new Scratch('migrate');
  try {
    scratch.write(
      'meta/_journal.json',
      JSON.stringify({
        entries: [
          { idx: 0, tag: '0000_widgets' },
          { idx: 1, tag: '0001_widgets_idx' },
        ],
      }),
    );
    scratch.write(
      '0000_widgets.sql',
      "CREATE TABLE widgets (id serial PRIMARY KEY, name text NOT NULL);\n--> statement-breakpoint\nINSERT INTO widgets (name) VALUES ('a');\n",
    );
    scratch.write(
      '0001_widgets_idx.sql',
      `${NO_TRANSACTION_MARKER}\nCREATE INDEX CONCURRENTLY widgets_name_idx ON widgets (name);\n`,
    );
    const first = await migrate(sql, { dir: scratch.dir, lockTimeout: '5s' });
    expect(first).toEqual(['0000_widgets', '0001_widgets_idx']);
    const rows = await sql<{ tag: string }[]>`SELECT tag FROM ${sql(MIGRATIONS_TABLE)} ORDER BY id`;
    expect(rows.map((r) => r.tag)).toContain('0001_widgets_idx');
    expect((await sql`SELECT count(*)::int AS n FROM widgets`)[0]?.n).toBe(1);
    expect(await migrate(sql, { dir: scratch.dir })).toEqual([]);
    expect(await pending(sql, scratch.dir)).toEqual([]);
    await sql.unsafe('DROP TABLE widgets');
  } finally {
    scratch.cleanup();
  }
});

test('the healthcheck job exits 0 when the database answers', async () => {
  expect(await healthcheck()).toBe(0);
});
