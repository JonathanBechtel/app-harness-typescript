/**
 * Ops plane: correlation context, log output, secret scrubbing.
 *
 * Holds no business logic and imports nothing from the rest of the app
 * (dependency-cruiser contract 5). Field names are a stable vocabulary so one
 * query spans web requests and scheduled jobs.
 */

export {
  bind,
  currentContext,
  FIELD_JOB,
  FIELD_OUTCOME,
  FIELD_REQUEST_ID,
  FIELD_RUN_ID,
  newCorrelationId,
  sanitizeCorrelationId,
} from './context.js';
export { bindJobRun } from './jobs.js';
export { getLogger, getRootLogger, type Log } from './logger.js';
