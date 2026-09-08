/** Request transaction policy: explicit transaction control is rejected in request-bounded code. */

import { afterEach, beforeEach, expect, test } from 'vitest';

import * as guard from '../../scripts/check-request-transaction-policy.js';
import { Scratch } from './_temp.js';

let scratch: Scratch;
beforeEach(() => {
  scratch = new Scratch('txn');
});
afterEach(() => {
  scratch.cleanup();
});

test('commit(), rollback(), startTransaction and raw COMMIT statements are reported; withTransaction passes', () => {
  const out = guard.checkPaths([
    scratch.write(
      'widget-service.ts',
      `
      export async function save(db, sql) {
        const trx = await db.startTransaction();
        await trx.commit();
        await trx.rollback();
        await sql\`COMMIT\`;
        await db.execute('ROLLBACK');
      }
    `,
    ),
  ]);
  expect(out).toHaveLength(5);
  expect(out.join('\n')).toMatch(/explicit commit\(\)/);
  expect(out.join('\n')).toMatch(/raw COMMIT statement/);
  const clean = guard.checkPaths([
    scratch.write(
      'clean-service.ts',
      `
      export async function save(db) {
        return withTransaction(db, async (tx) => tx.insert(widgets).values({}));
      }
    `,
    ),
  ]);
  expect(clean).toEqual([]);
});

test('the repo is clean: routes and services use structural transactions only', () => {
  expect(guard.checkAll()).toEqual([]);
});
