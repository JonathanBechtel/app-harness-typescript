/** Migration-safety guard: M1-M5 fire on seeded revisions; the template's runner and journal are clean. */

import { afterEach, beforeEach, expect, test } from 'vitest';

import * as guard from '../../scripts/check-migration-safety.js';
import { Scratch } from './_temp.js';

let scratch: Scratch;
beforeEach(() => {
  scratch = new Scratch('migrations');
});
afterEach(() => {
  scratch.cleanup();
});

test('a non-concurrent CREATE INDEX is M1 unless waived with a reason', () => {
  const bad = scratch.write('0001_idx.sql', 'CREATE INDEX widgets_name_idx ON widgets (name);\n');
  expect(guard.checkRevision(bad)[0]).toContain('M1');
  const waived = scratch.write(
    '0002_idx.sql',
    '-- discipline: migration-safety table is empty at this revision\nCREATE INDEX widgets_name_idx ON widgets (name);\n',
  );
  expect(guard.checkRevision(waived)).toEqual([]);
});

test('CONCURRENTLY without the no-transaction marker is M2; a marked revision holding other DDL is M3', () => {
  const m2 = scratch.write(
    '0001_idx.sql',
    'CREATE INDEX CONCURRENTLY widgets_name_idx ON widgets (name);\n',
  );
  expect(guard.checkRevision(m2).map((v) => v.split(' ')[1])).toEqual(['M2']);
  const m3 = scratch.write(
    '0002_mixed.sql',
    `${guard.NO_TRANSACTION_MARKER}\nCREATE TABLE t (id int);\n--> statement-breakpoint\nCREATE INDEX CONCURRENTLY t_idx ON t (id);\n`,
  );
  expect(guard.checkRevision(m3).map((v) => v.split(' ')[1])).toEqual(['M3']);
  const ok = scratch.write(
    '0003_ok.sql',
    `${guard.NO_TRANSACTION_MARKER}\nCREATE UNIQUE INDEX CONCURRENTLY t_idx ON t (id);\n`,
  );
  expect(guard.checkRevision(ok)).toEqual([]);
});

test('a runner without an executed lock_timeout or a per-revision begin is M4', () => {
  const bad = scratch.write(
    'migrate.ts',
    'export async function migrate(client) { for (const s of all) { await client.unsafe(s); } }\n',
  );
  expect(guard.checkRunner(bad).map((v) => v.split(' ')[1])).toEqual(['M4', 'M4']);
  const good = scratch.write(
    'ok.ts',
    "export async function migrate(client) { await client.unsafe(\"SELECT set_config('lock_timeout', $1, false)\", ['10s']); await client.begin(async (tx) => tx.unsafe(s)); }\n",
  );
  expect(guard.checkRunner(good)).toEqual([]);
});

test('a journal with a gap, a missing file, or an unjournalled revision is M5', () => {
  scratch.write(
    'meta/_journal.json',
    JSON.stringify({
      entries: [
        { idx: 0, tag: '0000_init' },
        { idx: 2, tag: '0002_later' },
      ],
    }),
  );
  scratch.write('0000_init.sql', 'CREATE TABLE t (id int);\n');
  scratch.write('0001_orphan.sql', 'SELECT 1;\n');
  const out = guard.checkJournal(scratch.dir);
  expect(out.join('\n')).toMatch(/expected idx 1, found 2/);
  expect(out.join('\n')).toMatch(/0002_later\.sql but the file is missing/);
  expect(out.join('\n')).toMatch(/0001_orphan\.sql: M5 revision file is not in meta/);
});

test('the repo is clean: the template runner satisfies M4 and the journal is linear', () => {
  expect(guard.checkRunner()).toEqual([]);
  expect(guard.checkJournal()).toEqual([]);
});
