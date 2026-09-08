/**
 * Redact configured secret values before a log record leaves the process.
 *
 * No entropy heuristics, no "looks like a key" regexes: the scrubber takes the
 * values it *knows* are secret (from settings) and removes those exact strings.
 * That has no false positives and cannot be defeated by a credential format
 * nobody anticipated. The one shape-aware addition is the DSN password, which
 * appears in derived forms (a driver error string) where the full URL does not.
 */

import type { Settings } from '../config.js';

export const REDACTED = '[REDACTED]';

// Settings fields whose value is a credential. Adding a secret to app/config.ts
// means adding it here; tests/unit/settings-documented.test.ts asserts this list
// covers every credential-shaped field.
export const SECRET_SETTING_FIELDS = [
  'secretKey',
  'databaseUrl',
  'anthropicApiKey',
] as const satisfies readonly (keyof Settings)[];

const PLACEHOLDERS = new Set(['', 'change-me']);

function dsnPassword(value: string): string | undefined {
  if (!value.includes('://')) {
    return undefined;
  }
  try {
    const password = decodeURIComponent(new URL(value).password);
    return password === '' ? undefined : password;
  } catch {
    return undefined;
  }
}

/** Return every secret string the process holds, longest first. */
export function collectSecretValues(settings: Settings): readonly string[] {
  const values = new Set<string>();
  for (const field of SECRET_SETTING_FIELDS) {
    const value = settings[field];
    if (typeof value !== 'string' || PLACEHOLDERS.has(value)) {
      continue;
    }
    values.add(value);
    const password = dsnPassword(value);
    if (password !== undefined) {
      values.add(password);
    }
  }
  return [...values].sort((a, b) => b.length - a.length);
}

/** Replace every secret in `text` with a redaction marker. */
export function scrub(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret !== '' && out.includes(secret)) {
      out = out.replaceAll(secret, REDACTED);
    }
  }
  return out;
}
