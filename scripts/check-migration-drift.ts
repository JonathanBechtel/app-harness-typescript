/**
 * Assert the committed revisions and the canonical schema agree.
 *
 * "Migrations apply cleanly" and "migrations produce the schema in app/models"
 * are different claims: a table added to a model module without running
 * `npm run mig.generate` passes every test that creates tables from migrations
 * and then fails in production the first time the code touches the column.
 * This runs drizzle-kit's generator against a scratch copy of the journal; if
 * it would write a new revision, the two have drifted. Never touches a database
 * and never writes into app/migrations. Run after a fresh-database migrate in CI
 * (`npm run lint.migrations.roundtrip`).
 */

import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { isMain, REPO } from './_check-runner.js';

const MIGRATIONS = path.join(REPO, 'app', 'migrations');
const SCHEMA = './app/models/*.ts';

/** True when drizzle-kit would emit a new revision from the current schema. */
export function schemaHasDrifted(): { drifted: boolean; detail: string } {
  const scratch = mkdtempSync(path.join(tmpdir(), 'migration-drift-'));
  try {
    cpSync(MIGRATIONS, scratch, { recursive: true });
    const before = new Set(readdirSync(scratch));
    const kit = path.join(REPO, 'node_modules', 'drizzle-kit', 'bin.cjs');
    const result = spawnSync(
      process.execPath,
      [
        kit,
        'generate',
        '--dialect',
        'postgresql',
        '--schema',
        SCHEMA,
        '--out',
        scratch,
        '--name',
        'drift-check',
      ],
      { cwd: REPO, encoding: 'utf8' },
    );
    if (result.status !== 0) {
      throw new Error(`drizzle-kit generate failed: ${(result.stderr + result.stdout).trim()}`);
    }
    const added = readdirSync(scratch).filter((f) => f.endsWith('.sql') && !before.has(f));
    return {
      drifted: added.length > 0,
      detail:
        added.length > 0
          ? `drizzle-kit would write ${added.join(', ')}`
          : 'schema and revisions agree',
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export function main(): number {
  const { drifted, detail } = schemaHasDrifted();
  if (drifted) {
    console.error(
      `migration drift: ${detail}\n  app/models changed without a revision; run \`npm run mig.generate m="<describe the change>"\` and commit the result.`,
    );
    return 1;
  }
  console.log(`migration drift: ${detail}`);
  return 0;
}

if (isMain(import.meta)) {
  process.exitCode = main();
}
