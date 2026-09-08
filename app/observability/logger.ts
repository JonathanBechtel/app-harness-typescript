/**
 * Log output: one pino root, JSON for deployed output, console for local reading.
 *
 * `getLogger(name)` hands out named loggers that always write through the
 * current root, so a module-level logger created before `configureLogging`
 * ran still picks up the configured format, level, and scrub list (the same
 * property the stdlib registry gives Python's `logging.getLogger`).
 * Every line is scrubbed of known secrets right before it is written.
 */

import { createRequire } from 'node:module';

import pino, { type Logger, type LogFn } from 'pino';

import { currentContext } from './context.js';
import { scrub } from './scrubbing.js';

export interface LoggingOptions {
  readonly level: string;
  readonly json: boolean;
  readonly secrets: readonly string[];
  /** Where formatted lines go (default: stdout). Tests capture output here. */
  readonly sink?: (line: string) => void;
}

type Level = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
const LEVELS: readonly Level[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

/** The logging surface application code uses. */
export type Log = Readonly<Record<Level, LogFn>>;

type PrettyFactory = (options: Record<string, unknown>) => (line: string) => string;

/** pino-pretty is a dev dependency; outside dev the image does not carry it. */
function loadPrettyFactory(): PrettyFactory | undefined {
  try {
    const require = createRequire(import.meta.url);
    const mod = require('pino-pretty') as { prettyFactory: PrettyFactory };
    return mod.prettyFactory;
  } catch {
    return undefined;
  }
}

function makeWriter(options: LoggingOptions): (line: string) => void {
  const secrets = [...options.secrets];
  const sink = options.sink ?? ((line: string): void => void process.stdout.write(line));
  const pretty = options.json ? undefined : loadPrettyFactory();
  if (pretty === undefined) {
    return (line) => {
      sink(scrub(line, secrets));
    };
  }
  const format = pretty({
    colorize: process.stdout.isTTY,
    translateTime: 'HH:MM:ss',
    ignore: 'pid,hostname',
    messageKey: 'message',
    timestampKey: 'ts',
    sync: true,
  });
  return (line) => {
    sink(format(scrub(line, secrets)));
  };
}

/** Create a configured pino root. Field names are a stable vocabulary shared by requests and jobs. */
export function createRootLogger(options: LoggingOptions): Logger {
  const write = makeWriter(options);
  return pino(
    {
      level: options.level,
      base: null,
      messageKey: 'message',
      errorKey: 'exception',
      timestamp: () => `,"ts":"${new Date().toISOString()}"`,
      formatters: { level: (label) => ({ level: label }) },
      mixin: () => ({ ...currentContext() }),
    },
    { write },
  );
}

let root: Logger = createRootLogger({ level: 'info', json: true, secrets: [] });
const children = new WeakMap<Logger, Map<string, Logger>>();

/** Replace the process-wide root (called by `configureLogging`). */
export function setRootLogger(logger: Logger): void {
  root = logger;
}

/** The current root pino instance (for frameworks that want a pino logger). */
export function getRootLogger(): Logger {
  return root;
}

function childOf(name: string): Logger {
  let cache = children.get(root);
  if (cache === undefined) {
    cache = new Map();
    children.set(root, cache);
  }
  let child = cache.get(name);
  if (child === undefined) {
    child = root.child({ logger: name });
    cache.set(name, child);
  }
  return child;
}

/** A named logger that follows the current root configuration. */
export function getLogger(name: string): Log {
  const entries = LEVELS.map((level) => {
    const fn = function log(this: unknown, ...args: unknown[]): void {
      const child = childOf(name);
      const target: (...a: unknown[]) => void = child[level];
      target.apply(child, args);
    } as LogFn;
    return [level, fn] as const;
  });
  return Object.freeze(Object.fromEntries(entries)) as Log;
}
