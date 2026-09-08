/**
 * Example runtime job: probe the database and exit non-zero if it is unreachable.
 *
 * Usage: `node dist/app/cli/healthcheck.js` (or `tsx app/cli/healthcheck.ts`).
 * Keep it as the smallest working example of the `app/cli` shape; real jobs
 * follow the same pattern.
 */

import { getLogger } from '../observability/index.js';
import { checkDatabaseReadiness } from '../utils/db.js';
import { isMain, runJob } from './_runner.js';

const log = getLogger('app.cli.healthcheck');

/** Return 0 when the database answers, 1 otherwise. */
export async function main(): Promise<number> {
  const report = await checkDatabaseReadiness();
  if (report.databaseOk) {
    log.info({ latency_ms: report.latencyMs }, 'database ok');
    return 0;
  }
  log.error({ error: report.error }, 'database unavailable');
  return 1;
}

if (isMain(import.meta)) {
  await runJob('healthcheck', main);
}
