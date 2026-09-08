/**
 * Settings: the only place the process reads its environment.
 *
 * Every configuration value the app uses is a field of `SettingsSchema`, read
 * once from the environment (and `.env` in dev), validated at startup. Nothing
 * else reads `process.env` for application config; `tests/unit/settings-documented.test.ts`
 * asserts every field is documented in `.env.example` and every credential-shaped
 * field is in the log scrubbing list.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/** Walk up from `start` to the directory holding package.json (works from app/ and dist/app/). */
function findRepoRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return start;
    }
    dir = parent;
  }
}

export const REPO_ROOT = findRepoRoot(import.meta.dirname);

const TRUE_WORDS = new Set(['1', 'true', 'yes', 'on']);
const FALSE_WORDS = new Set(['0', 'false', 'no', 'off']);

/** `1/true/yes/on` and `0/false/no/off` (case-insensitive) become booleans. */
const flag = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }
  const word = value.trim().toLowerCase();
  if (TRUE_WORDS.has(word)) {
    return true;
  }
  if (FALSE_WORDS.has(word)) {
    return false;
  }
  return value;
}, z.boolean());

/** Process configuration. Keys are camelCase; the env var is the UPPER_SNAKE form (see `envName`). */
export const SettingsSchema = z.object({
  env: z.enum(['dev', 'stage', 'prod']).default('dev'),
  debug: flag.default(false),
  logLevel: z.string().default('info'),
  // One JSON object per line outside dev; console format in dev. Unset means
  // "decide from env"; set LOG_JSON explicitly to force either.
  logJson: flag.optional(),
  secretKey: z.string().default('change-me'),
  host: z.string().default('0.0.0.0'),
  port: z.coerce.number().int().positive().default(8000),

  databaseUrl: z.string().default('postgresql://postgres:postgres@localhost:5439/app'),
  // Per process. Ceiling on Postgres connections is dbPoolSize * replicas.
  dbPoolSize: z.coerce.number().int().positive().default(10),
  // A request that cannot get a connection fails after this many seconds
  // instead of stalling. Must stay above READINESS_TIMEOUT_SECONDS in app/utils/db.ts.
  dbPoolTimeout: z.coerce.number().int().positive().default(10),

  // LLM roles resolve to (provider, model) here; nothing else names a model.
  anthropicApiKey: z.string().optional(),
  aiDefaultProvider: z.string().default('anthropic'),
  aiDefaultModel: z.string().default('claude-opus-5'),

  // Injected by the image build; reported by /health for drift detection.
  releaseSha: z.string().optional(),
});

type ParsedSettings = z.infer<typeof SettingsSchema>;
export type SettingKey = keyof ParsedSettings;

/** Validated process configuration plus derived flags. */
export interface Settings extends Readonly<ParsedSettings> {
  /** True in local development. */
  readonly isDev: boolean;
  /** True in production, where runtime guards warn instead of raise. */
  readonly isProd: boolean;
  /** JSON logs are on outside dev unless LOG_JSON overrides. */
  readonly jsonLogs: boolean;
}

export const SETTING_KEYS = Object.keys(SettingsSchema.shape) as readonly SettingKey[];

/** `dbPoolSize` -> `DB_POOL_SIZE`; `env` -> `APP_ENV`. */
export function envName(key: SettingKey): string {
  if (key === 'env') {
    return 'APP_ENV';
  }
  return key.replace(/([A-Z])/g, '_$1').toUpperCase();
}

/** Build settings from an environment mapping (empty strings count as unset). */
export function parseSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  const raw: Record<string, string> = {};
  for (const key of SETTING_KEYS) {
    const value = env[envName(key)] ?? (key === 'env' ? env.ENV : undefined);
    if (value !== undefined && value !== '') {
      raw[key] = value;
    }
  }
  const parsed = SettingsSchema.parse(raw);
  const isDev = parsed.env === 'dev';
  return {
    ...parsed,
    isDev,
    isProd: parsed.env === 'prod',
    jsonLogs: parsed.logJson ?? !isDev,
  };
}

let cached: Settings | undefined;

/** Return the process-wide settings (cached; reads `.env` from the repo root once). */
export function getSettings(): Settings {
  if (cached === undefined) {
    loadDotenv({ path: path.join(REPO_ROOT, '.env'), override: false, quiet: true });
    cached = parseSettings(process.env);
  }
  return cached;
}

export const settings: Settings = getSettings();
