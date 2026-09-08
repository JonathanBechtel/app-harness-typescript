/**
 * Logging setup shared by the web app and every `app/cli` entrypoint.
 *
 * One call configures both, on purpose: a scheduled job's output should be
 * queryable the same way a request's is.
 */

import type { Logger } from 'pino';

import { type Settings, settings } from './config.js';
import { createRootLogger, setRootLogger } from './observability/logger.js';
import { collectSecretValues } from './observability/scrubbing.js';

export interface ConfigureLoggingOptions {
  /** Root log level name; defaults to `settings.logLevel`. */
  readonly level?: string;
  /** Force JSON (true) or console (false); undefined defers to settings. */
  readonly jsonLogs?: boolean;
  /** Settings to read defaults and the scrub list from. */
  readonly appSettings?: Settings;
}

/** Configure the process-wide root logger and return it. */
export function configureLogging(options: ConfigureLoggingOptions = {}): Logger {
  const resolved = options.appSettings ?? settings;
  const root = createRootLogger({
    level: (options.level ?? resolved.logLevel).toLowerCase(),
    json: options.jsonLogs ?? resolved.jsonLogs,
    secrets: collectSecretValues(resolved),
  });
  setRootLogger(root);
  return root;
}
