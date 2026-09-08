import { defineConfig } from 'vitest/config';

import { resolveDatabaseGate } from './tests/integration/gate.js';

// The integration tier is opt-in (TEST_DATABASE_URL + TEST_ALLOW_DB=1) and, when
// TEST_REQUIRE_DB=1, a missing database FAILS the run at config time instead of
// silently skipping every test into a green-looking exit 0.
const gate = resolveDatabaseGate(process.env);
if (gate.kind === 'skip') {
  console.warn(`integration tests skipped: ${gate.reason}`);
}

export default defineConfig({
  test: {
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: ['app/**/*.ts'],
      exclude: ['app/**/index.ts', 'app/main.ts'],
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: 'coverage',
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          setupFiles: ['tests/setup-env.ts', 'tests/unit/setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: gate.kind === 'run' ? ['tests/integration/**/*.test.ts'] : [],
          setupFiles: ['tests/setup-env.ts'],
          globalSetup: gate.kind === 'run' ? ['tests/integration/global-setup.ts'] : [],
          fileParallelism: false,
        },
      },
    ],
  },
});
