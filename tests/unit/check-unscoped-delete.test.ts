/** Unscoped-delete guard: every spelling of a bulk delete without a filter is caught. */

import { afterEach, beforeEach, expect, test } from 'vitest';

import * as guard from '../../scripts/check-unscoped-delete.js';
import { Scratch } from './_temp.js';

let scratch: Scratch;
beforeEach(() => {
  scratch = new Scratch('delete');
});
afterEach(() => {
  scratch.cleanup();
});

const run = (source: string): string[] => guard.checkFile(scratch.write('repo.ts', source));

test('db.delete(table) with no .where() is reported, including through an alias and a typed handle', () => {
  const out = run(`
    import type { DbHandle } from '../utils/db.js';
    export async function wipe(db, handle: DbHandle) {
      await db.delete(widgets);
      const conn = db;
      await conn.delete(widgets).returning();
      await handle.delete(widgets);
    }
  `);
  expect(out).toHaveLength(3);
  expect(out[0]).toContain('unscoped delete(...) with no .where()');
});

test('a scoped delete, a Map delete, and a waived statement are not reported', () => {
  const out = run(`
    export async function ok(db, cache: Map<string, number>) {
      await db.delete(widgets).where(eq(widgets.id, 1));
      cache.delete('k');
      await db.delete(demo); // discipline: unscoped-delete demo table, seed script
    }
  `);
  expect(out).toEqual([]);
});

test('raw DELETE FROM without WHERE in sql templates or execute strings is reported', () => {
  const out = run(`
    export async function raw(db, sql) {
      await sql\`DELETE FROM widgets\`;
      await db.execute('DELETE FROM widgets WHERE id = 1');
      await db.execute(sql\`delete from widgets\`);
    }
  `);
  expect(out).toHaveLength(2);
  expect(out[0]).toContain('raw DELETE FROM with no WHERE');
});

test('the repo is clean: no unscoped deletes under app/ or scripts/', () => {
  expect(guard.checkAll()).toEqual([]);
});
