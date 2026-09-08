/** Entrypoint boundary, docs freshness, and module conventions: seeded failures fire; the tree is clean. */

import path from 'node:path';

import { afterEach, beforeEach, expect, test } from 'vitest';

import * as docs from '../../scripts/check-docs-freshness.js';
import * as modules from '../../scripts/check-module-conventions.js';
import * as entry from '../../scripts/check-runtime-entrypoints.js';
import { TASKS } from '../../tasks.js';
import { Scratch } from './_temp.js';

let scratch: Scratch;
beforeEach(() => {
  scratch = new Scratch('structural');
});
afterEach(() => {
  scratch.cleanup();
});

test('E2 fires on an import from scripts/ and E3 on a string literal naming a dockerignored path', () => {
  const file = scratch.write(
    'app/services/thing-service.ts',
    `
    import { helper } from '../../scripts/helper.js';
    /** reads scripts/data -- comments are exempt */
    export const DATA = 'scripts/data/fixture.json';
    export const OK = 'app/data/fixture.json';
    export const url = \`https://x/tests/\${id}\`;
    `,
  );
  const out = entry.checkE2E3([file], new Set(['scripts', 'tests']));
  expect(out).toHaveLength(3);
  expect(out[0]).toContain('E2');
  expect(out[1]).toContain('E3');
  expect(out[2]).toContain('tests/');
});

test('excludedDirs reads trailing-slash entries from .dockerignore and skips globs, negations and dotfiles', () => {
  const file = scratch.write(
    '.dockerignore',
    '# c\n.git/\n!.env.example\n*.log\nscripts/\ntests/\nnode_modules/\n',
  );
  expect([...entry.excludedDirs(file)].sort()).toEqual(['node_modules', 'scripts', 'tests']);
  expect(entry.excludedDirs()).toContain('scripts');
});

test('D1 fires for a package with no CLAUDE.md or no table row; D2 once real code exists; D3 for an unknown task', () => {
  scratch.write('app/CLAUDE.md', '| `api/` | ... |\n');
  scratch.write('app/api/routes.ts', 'export {};\n');
  scratch.write('app/billing/invoice-service.ts', 'export {};\n');
  scratch.write('app/static/x.css', '');
  scratch.write(
    'CLAUDE.md',
    `${docs.PLACEHOLDER}\nRun \`npm run checks\` and \`npm run frobnicate\`.\n`,
  );
  scratch.write('docs/architecture/overview.md', `${docs.PLACEHOLDER}\n`);
  const d1 = docs.checkPackageDocs(scratch.dir);
  expect(d1.sort()).toEqual([
    'D1 app/CLAUDE.md has no table row for `billing/`',
    'D1 app/api/ has no CLAUDE.md',
    'D1 app/billing/ has no CLAUDE.md',
  ]);
  expect(docs.checkPlaceholders([], scratch.dir)).toEqual([]);
  expect(docs.checkPlaceholders(['app/billing/invoice-service.ts'], scratch.dir)).toHaveLength(2);
  const d3 = docs.checkReferences(new Set(['checks']), scratch.dir);
  expect(d3).toEqual(['D3 CLAUDE.md names task `frobnicate` but tasks.ts has no such task']);
});

test('MODC001-003 fire on misnamed and misplaced modules; private and index modules are exempt', () => {
  const root = scratch.dir;
  const entries: modules.Enrolled[] = [
    { path: path.join(root, 'app/services'), rules: new Set(['services']) },
    { path: path.join(root, 'app/billing'), rules: new Set(['services', 'models']) },
  ];
  const bad = scratch.write('app/services/widgets.ts', 'export function a() {}\n');
  const priv = scratch.write('app/services/_shared.ts', 'export function a() {}\n');
  const misplaced = scratch.write('app/billing/invoice-service.ts', 'export {};\n');
  const shape = scratch.write(
    'app/billing/invoice.ts',
    "import { z } from 'zod';\nexport const Invoice = z.object({});\n",
  );
  const nested = scratch.write('app/billing/models/invoice.ts', 'export {};\n');
  expect(modules.checkFile(bad, entries)[0]).toContain('MODC001');
  expect(modules.checkFile(priv, entries)).toEqual([]);
  expect(modules.checkFile(misplaced, entries)[0]).toContain('MODC002');
  expect(modules.checkFile(shape, entries)[0]).toContain('MODC003 looks like models');
  expect(modules.checkFile(nested, entries)[0]).toContain('MODC001');
});

test('the repo is clean: entrypoints, docs freshness, and module conventions all pass on the template', () => {
  expect(entry.checkE1()).toEqual([]);
  expect(docs.checkPackageDocs()).toEqual([]);
  expect(docs.checkReferences(new Set(TASKS.keys()))).toEqual([]);
  expect(modules.checkAll()).toEqual([]);
});
