/** Route-conventions guard: each rule fires on a seeded violation and stays quiet on compliant code. */

import { afterEach, beforeEach, expect, test } from 'vitest';

import * as guard from '../../scripts/check-route-conventions.js';
import { Scratch } from './_temp.js';

let scratch: Scratch;
beforeEach(() => {
  scratch = new Scratch('routes');
});
afterEach(() => {
  scratch.cleanup();
});

const run = (source: string, name = 'routes.ts'): string[] =>
  guard.checkPaths([scratch.write(name, source)]);

test('a route with no options or no schema.response trips R1', () => {
  const out = run(`
    export const routes = async (app) => {
      app.get('/x', async () => ({}));
      app.post('/y', { schema: { body: Body } }, async () => ({}));
    };
  `);
  expect(out.filter((v) => v.includes('[R1]'))).toHaveLength(2);
});

test('a write route whose response keys are not explicit numeric statuses trips R2', () => {
  const out = run(`
    export const routes = async (app) => {
      app.post('/x', { schema: { response: { default: Shape } } }, async () => ({}));
      app.route({ method: 'DELETE', url: '/y', schema: { response: { '2xx': Shape } }, handler: async () => ({}) });
      app.put('/z', { schema: { response: { 200: Shape } } }, async () => ({}));
    };
  `);
  expect(out.filter((v) => v.includes('[R2]'))).toHaveLength(2);
});

test('importing the module-level client or building one inline trips R3, even through an alias; app.db passes', () => {
  const out = run(`
    import { db as database, checkDatabaseReadiness } from '../../utils/db.js';
    import postgres from 'postgres';
    const connect = postgres;
    export const routes = async (app) => {
      app.get('/x', { schema: { response: { 200: Shape } } }, async () => { const c = connect('url'); return c; });
    };
  `);
  expect(out.filter((v) => v.includes('[R3]'))).toHaveLength(2);
  const clean = run(`
    import type { Db } from '../../utils/db.js';
    import { checkDatabaseReadiness } from '../../utils/db.js';
    export const routes = async (app) => {
      app.get('/x', { schema: { response: { 200: Shape } } }, async () => checkDatabaseReadiness(app.db));
    };
  `);
  expect(clean).toEqual([]);
});

test('a page template that does not extend base.njk trips R4; base.njk and partials are exempt', () => {
  const page = scratch.write('templates/widgets.njk', '<h1>{{ title }}</h1>\n');
  const base = scratch.write('templates/base.njk', '<html></html>\n');
  const partial = scratch.write('templates/partials/row.njk', '<tr></tr>\n');
  const good = scratch.write(
    'templates/good.njk',
    '{% extends "base.njk" %}\n{% block content %}x{% endblock %}\n',
  );
  const out = guard.checkPaths([page, base, partial, good]);
  expect(out).toHaveLength(1);
  expect(out[0]).toContain('[R4]');
  expect(out[0]).toContain('widgets.njk');
});

test('a reasoned discipline waiver on the route statement exempts R1/R2; a bare marker does not', () => {
  const waived = run(`
    export const routes = async (app) => {
      // discipline: route-conventions webhook echoes raw bytes
      app.post('/x', async () => ({}));
    };
  `);
  expect(waived).toEqual([]);
  const bare = run(`
    export const routes = async (app) => {
      app.post('/x', async () => ({})); // discipline: route-conventions
    };
  `);
  expect(bare.length).toBeGreaterThan(0);
});

test('the repo is clean: the template routes and templates satisfy every rule', () => {
  expect(guard.checkAll()).toEqual([]);
});
