/**
 * Integration fixtures: a real Postgres, isolated per run by schema.
 *
 * One randomly named schema per run; tables created by applying the repo's own
 * revisions into it (the same runner production uses); dropped afterwards. Each
 * test file gets the schema name through `inject('testSchema')` and opens its
 * own connections with that search_path (see fixtures.ts).
 */

import postgres from 'postgres';
import type { TestProject } from 'vitest/node';

import { migrate } from '../../app/cli/migrate.js';
import { resolveDatabaseGate } from './gate.js';

declare module 'vitest' {
  export interface ProvidedContext {
    testSchema: string;
    testDatabaseUrl: string;
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const gate = resolveDatabaseGate(process.env);
  if (gate.kind === 'skip') {
    return async () => undefined;
  }
  const schema = `vitest_${Math.random().toString(16).slice(2, 14)}`;
  const admin = postgres(gate.url, { max: 1, onnotice: () => undefined });
  await admin.unsafe(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  await admin.end();

  const runner = postgres(gate.url, {
    max: 1,
    onnotice: () => undefined,
    connection: { search_path: `"${schema}"` },
  });
  try {
    await migrate(runner);
  } finally {
    await runner.end();
  }
  project.provide('testSchema', schema);
  project.provide('testDatabaseUrl', gate.url);

  return async () => {
    const cleanup = postgres(gate.url, { max: 1, onnotice: () => undefined });
    try {
      await cleanup.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await cleanup.end();
    }
  };
}
