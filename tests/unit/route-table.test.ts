/** The route table is the app's public surface; changes to it must be deliberate. */

import { expect, test } from 'vitest';

import { buildApp } from '../../app/app.js';

const EXPECTED = new Set(['GET /health', 'GET /health/db', 'GET /', 'GET /static/*']);

test('every (method, url) pair the app serves is listed here; update deliberately when adding routes', async () => {
  const app = await buildApp();
  try {
    await app.ready();
    const pairs = new Set(app.routeTable.map((r) => `${r.method} ${r.url}`));
    const added = [...pairs].filter((p) => !EXPECTED.has(p));
    const removed = [...EXPECTED].filter((p) => !pairs.has(p));
    expect({ added, removed }).toEqual({ added: [], removed: [] });
  } finally {
    await app.close();
  }
});
