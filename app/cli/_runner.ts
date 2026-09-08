/** Shared scaffolding for `app/cli` entrypoints. */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { configureLogging } from '../logging-config.js';
import { bindJobRun } from '../observability/index.js';
import { disposeEngine } from '../utils/db.js';

/** True when `meta` belongs to the module Node was asked to run (`node x.js` / `tsx x.ts`). */
export function isMain(meta: ImportMeta): boolean {
  const entry = process.argv[1];
  return entry !== undefined && path.resolve(entry) === fileURLToPath(meta.url);
}

/** Run an async job entrypoint with logging, correlation, and a clean exit code. */
export async function runJob(name: string, main: () => Promise<number>): Promise<never> {
  configureLogging();
  let code: number;
  try {
    code = await bindJobRun(name, main);
  } catch {
    code = 1;
  } finally {
    await disposeEngine();
  }
  process.exit(code);
}
