/**
 * Drop and recreate the public schema of DATABASE_URL. For the migration
 * round-trip only (`npm run lint.migrations.roundtrip`), against a DISPOSABLE
 * database: the whole point is to start from nothing. Refuses to run when
 * APP_ENV=prod.
 */

import postgres from 'postgres';

import { isMain } from './_check-runner.js';

export async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === '') {
    console.error('DATABASE_URL is required');
    return 2;
  }
  if (process.env.APP_ENV === 'prod') {
    console.error('refusing to reset a prod database');
    return 2;
  }
  const client = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    await client.unsafe('DROP SCHEMA public CASCADE');
    await client.unsafe('CREATE SCHEMA public');
    console.log('reset: public schema recreated');
    return 0;
  } finally {
    await client.end({ timeout: 5 });
  }
}

if (isMain(import.meta)) {
  process.exitCode = await main();
}
