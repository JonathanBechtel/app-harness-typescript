/** Job-run correlation: bind a run id, log the outcome and duration, re-raise failures. */

import {
  bind,
  FIELD_DURATION_MS,
  FIELD_JOB,
  FIELD_OUTCOME,
  FIELD_RUN_ID,
  newCorrelationId,
  OUTCOME_FAILED,
  OUTCOME_SUCCEEDED,
} from './context.js';
import { getLogger } from './logger.js';

const log = getLogger('app.jobs');

/** Run `fn` under a bound job context; the run id is generated unless given. */
export async function bindJobRun<T>(
  job: string,
  fn: (runId: string) => Promise<T>,
  runId: string = newCorrelationId(),
): Promise<T> {
  const started = performance.now();
  const durationMs = (): number => Math.round(performance.now() - started);
  return bind({ [FIELD_JOB]: job, [FIELD_RUN_ID]: runId }, async () => {
    try {
      const result = await fn(runId);
      log.info(
        { [FIELD_OUTCOME]: OUTCOME_SUCCEEDED, [FIELD_DURATION_MS]: durationMs() },
        'job succeeded',
      );
      return result;
    } catch (error) {
      log.error(
        { err: error, [FIELD_OUTCOME]: OUTCOME_FAILED, [FIELD_DURATION_MS]: durationMs() },
        'job failed',
      );
      throw error;
    }
  });
}
