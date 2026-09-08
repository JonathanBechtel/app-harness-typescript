/**
 * Root test setup: force sandbox-safe settings before app modules import.
 *
 * CI often provides secrets as empty strings, and a developer's .env may point at a
 * real database. Settings are read at first import, so defaults are pinned here,
 * before anything under `app` is imported.
 */

process.env.APP_ENV ??= 'dev';
process.env.SECRET_KEY ??= 'test-secret-key';
process.env.LOG_JSON ??= '1';
process.env.LOG_LEVEL ??= 'warn';
process.env.RELEASE_SHA ??= 'testsha0000';
