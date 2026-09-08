/**
 * Role-based model routing.
 *
 * Failure this descends from: model ids hard-coded in six modules that silently
 * diverged across three models, so nothing could state what the app was billed
 * for. Every call site names a *role* ("summarizer", "classifier"); the role
 * resolves here, from configuration, to a (provider, model) pair. Per-role
 * overrides come from `AI_<ROLE>_PROVIDER` / `AI_<ROLE>_MODEL` environment
 * variables; anything unset falls back to the defaults in `app/config.ts`.
 * `tests/unit/model-centralization.test.ts` fails the build if a model id
 * appears anywhere else under `app/`.
 */

import { type Settings, settings } from '../config.js';

/** Resolved (provider, model) for one role. */
export interface ModelChoice {
  readonly role: string;
  readonly provider: string;
  readonly model: string;
}

function override(name: string, env: NodeJS.ProcessEnv): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value === '' ? undefined : value;
}

/** Return the provider/model for `role` (a short lowercase role name, e.g. "summarizer"). */
export function resolve(
  role: string,
  appSettings: Settings = settings,
  env: NodeJS.ProcessEnv = process.env,
): ModelChoice {
  const key = role.toUpperCase().replaceAll('-', '_');
  return {
    role,
    provider: override(`AI_${key}_PROVIDER`, env) ?? appSettings.aiDefaultProvider,
    model: override(`AI_${key}_MODEL`, env) ?? appSettings.aiDefaultModel,
  };
}
