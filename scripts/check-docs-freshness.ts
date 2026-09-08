/**
 * Agent documentation must describe the real application, not the template.
 *
 * This repository starts as a template. The value of CLAUDE.md is that the next
 * agent reads an accurate description of THIS app; the failure mode is a project
 * six months in whose CLAUDE.md still says "describe your product here". Three
 * mechanical rules keep the docs honest:
 *
 *   D1  Every code package under `app/` (a top-level directory other than the
 *       asset trees) has its own `CLAUDE.md` and a row in `app/CLAUDE.md`'s table.
 *   D2  Once the app has real code (any module under `app/` that is not part of
 *       the template's own skeleton), the `<!-- template:placeholder -->`
 *       markers in CLAUDE.md and `docs/architecture/overview.md` must be gone.
 *       Replace each marked section with the truth about this app.
 *   D3  Every `npm run` / `tsx tasks.ts` target CLAUDE.md names must exist in
 *       `tasks.ts`'s registry, and every `scripts/check-*.ts` must be
 *       mentioned in `docs/guides/programmatic-code-discipline.md`'s catalog.
 *
 * What counts as "real code" for D2: any `app/**\/*.ts` not listed in
 * `TEMPLATE_MODULES` below. Keep that list current when you extend the template
 * itself; do not add product modules to it.
 */

import { existsSync, globSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { isMain, readText, REPO, report } from './_check-runner.js';

export const PLACEHOLDER = '<!-- template:placeholder -->';
export const PLACEHOLDER_DOCS = ['CLAUDE.md', 'docs/architecture/overview.md'];
export const GUARD_CATALOG = 'docs/guides/programmatic-code-discipline.md';
/** Directories under app/ that hold assets, not code packages. */
export const ASSET_DIRS: ReadonlySet<string> = new Set([
  'templates',
  'static',
  'data',
  'migrations',
]);

export const TEMPLATE_MODULES: ReadonlySet<string> = new Set([
  'app/app.ts',
  'app/config.ts',
  'app/logging-config.ts',
  'app/main.ts',
  'app/api/deps.ts',
  'app/api/routes/health.ts',
  'app/web/routes.ts',
  'app/web/templating.ts',
  'app/models/base.ts',
  'app/models/index.ts',
  'app/schemas/health.ts',
  'app/schemas/web.ts',
  'app/cli/_runner.ts',
  'app/cli/healthcheck.ts',
  'app/cli/migrate.ts',
  'app/ai/index.ts',
  'app/ai/registry.ts',
  'app/ai/client.ts',
  'app/ai/prompts/loader.ts',
  'app/observability/index.ts',
  'app/observability/context.ts',
  'app/observability/jobs.ts',
  'app/observability/logger.ts',
  'app/observability/middleware.ts',
  'app/observability/scrubbing.ts',
  'app/utils/db.ts',
  'app/utils/network-guard.ts',
]);

function packages(root: string = REPO): string[] {
  return readdirSync(path.join(root, 'app'))
    .filter((name) => statSync(path.join(root, 'app', name)).isDirectory() && !ASSET_DIRS.has(name))
    .sort();
}

function realModules(root: string = REPO): string[] {
  return globSync('app/**/*.ts', { cwd: root })
    .map((p) => p.split(path.sep).join('/'))
    .filter((m) => !TEMPLATE_MODULES.has(m))
    .sort();
}

/** D1: every app package has a CLAUDE.md and a row in app/CLAUDE.md. */
export function checkPackageDocs(root: string = REPO): string[] {
  const out = new Set<string>();
  const tablePath = path.join(root, 'app/CLAUDE.md');
  const table = existsSync(tablePath) ? readText(tablePath) : '';
  for (const pkg of packages(root)) {
    if (!existsSync(path.join(root, 'app', pkg, 'CLAUDE.md'))) {
      out.add(`D1 app/${pkg}/ has no CLAUDE.md`);
    }
    if (!table.includes(`\`${pkg}/\``)) {
      out.add(`D1 app/CLAUDE.md has no table row for \`${pkg}/\``);
    }
  }
  return [...out].sort();
}

/** D2: once real code exists, placeholder markers must be resolved. */
export function checkPlaceholders(modules: readonly string[], root: string = REPO): string[] {
  if (modules.length === 0) {
    return [];
  }
  const out: string[] = [];
  for (const doc of PLACEHOLDER_DOCS) {
    const file = path.join(root, doc);
    const text = existsSync(file) ? readText(file) : '';
    const count = text.split(PLACEHOLDER).length - 1;
    if (count > 0) {
      out.push(
        `D2 ${doc} still has ${count} template placeholder section(s); the app has real code (${modules[0] ?? ''} ...). Describe the actual app.`,
      );
    }
  }
  return out;
}

/** Task names registered in tasks.ts (the single definition of every project task). */
async function taskNames(): Promise<Set<string>> {
  const tasks = (await import('../tasks.js')) as { TASKS: Map<string, unknown> };
  return new Set(tasks.TASKS.keys());
}

function namedTasks(claude: string): Set<string> {
  const named = new Set<string>();
  for (const pattern of [
    /`npm run ([a-zA-Z0-9_.-]+)/g,
    /`(?:npx )?tsx tasks\.ts ([a-zA-Z0-9_.-]+)/g,
  ]) {
    for (const match of claude.matchAll(pattern)) {
      named.add(match[1] ?? '');
    }
  }
  return named;
}

function uncataloguedGuards(root: string): string[] {
  const catalogPath = path.join(root, GUARD_CATALOG);
  const catalog = existsSync(catalogPath) ? readText(catalogPath) : '';
  return globSync('scripts/check-*.ts', { cwd: root })
    .map((script) => path.basename(script))
    .sort()
    .filter((name) => !catalog.includes(name))
    .map((name) => `D3 scripts/${name} is not in the guard catalog (${GUARD_CATALOG})`);
}

/** D3: npm run / tsx targets named in CLAUDE.md exist; every guard script is catalogued. */
export function checkReferences(targets: ReadonlySet<string>, root: string = REPO): string[] {
  const claude = readText(path.join(root, 'CLAUDE.md'));
  const out = [...namedTasks(claude)]
    .sort()
    .filter((target) => !targets.has(target))
    .map((target) => `D3 CLAUDE.md names task \`${target}\` but tasks.ts has no such task`);
  return [...out, ...uncataloguedGuards(root)];
}

export async function main(): Promise<number> {
  const violations = [
    ...checkPackageDocs(),
    ...checkPlaceholders(realModules()),
    ...checkReferences(await taskNames()),
  ];
  return report('Docs freshness', violations, {
    okMessage: 'docs freshness: OK',
    footer: 'Agent docs must describe this app. See docs/guides/self-documentation.md.',
  });
}

if (isMain(import.meta)) {
  process.exitCode = await main();
}
