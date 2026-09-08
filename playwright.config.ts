import { defineConfig } from '@playwright/test';

// Browser tests against a RUNNING server (`npm run dev`), opt-in via `npm run test.e2e`.
// Screenshots land in tests/e2e/screenshots/ for a human (or a multimodal agent)
// to read. There is no pixel diffing: the verdict is a judgment, not a hash.
export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.TEST_BASE_URL ?? 'http://localhost:8000',
    viewport: { width: 1280, height: 800 },
    headless: process.env.PLAYWRIGHT_HEADLESS !== '0',
  },
  // PLAYWRIGHT_CHANNEL=chrome drives the system Chrome when the bundled Chromium
  // is unavailable (an OS outside Playwright's support window).
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
      },
    },
  ],
});
