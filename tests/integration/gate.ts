/**
 * The database gate for the integration tier.
 *
 * Explicit opt-in with an anti-silent-skip: skipping is right on a laptop with no
 * database, but on a box that is EXPECTED to run the suite (CI, anything
 * bootstrapped) `TEST_REQUIRE_DB=1` turns a missing URL into a failure --
 * otherwise the suite exits 0 with every test skipped, indistinguishable from
 * green. Evaluated at vitest config time, so a required-but-missing database
 * fails the run before a single test is collected.
 */

export type DatabaseGate =
  | { readonly kind: 'run'; readonly url: string }
  | { readonly kind: 'skip'; readonly reason: string };

function sameDatabase(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.hostname === y.hostname && x.port === y.port && x.pathname === y.pathname;
  } catch {
    return a === b;
  }
}

/** Decide whether the integration tier runs, from an environment mapping. */
export function resolveDatabaseGate(env: NodeJS.ProcessEnv): DatabaseGate {
  const testUrl = env.TEST_DATABASE_URL;
  const appUrl = env.DATABASE_URL;
  if (testUrl === undefined || testUrl === '') {
    const message = 'No TEST_DATABASE_URL configured for integration tests.';
    if (env.TEST_REQUIRE_DB === '1') {
      throw new Error(
        `${message} TEST_REQUIRE_DB=1 says this environment must run them, not skip them.`,
      );
    }
    return { kind: 'skip', reason: message };
  }
  if (env.TEST_ALLOW_DB !== '1') {
    throw new Error('Set TEST_ALLOW_DB=1 to confirm TEST_DATABASE_URL is safe to mutate.');
  }
  if (
    appUrl !== undefined &&
    appUrl !== '' &&
    env.TEST_ALLOW_TEST_DB_EQUALS_DATABASE_URL !== '1' &&
    sameDatabase(testUrl, appUrl)
  ) {
    return {
      kind: 'skip',
      reason:
        'TEST_DATABASE_URL equals DATABASE_URL; refusing (override with TEST_ALLOW_TEST_DB_EQUALS_DATABASE_URL=1).',
    };
  }
  return { kind: 'run', url: testUrl };
}
