/**
 * Shared Nunjucks configuration.
 *
 * Registering filters in one place keeps the app's template environment and any
 * standalone environment (tests rendering a partial directly) in agreement.
 */

import type { Environment } from 'nunjucks';

function isoformat(value: Date | string | null | undefined): string {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Register the app's custom Nunjucks filters on `env`. */
export function registerTemplateFilters(env: Environment): void {
  env.addFilter('iso', isoformat);
}
