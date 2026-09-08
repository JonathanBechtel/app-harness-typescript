/** Smoke: the landing page renders and its JS ran. */

import path from 'node:path';

import { expect, test } from '@playwright/test';

const SCREENSHOTS = path.join(import.meta.dirname, 'screenshots');

test('the page loads, the landing card is visible, main.js marked the document ready, and a screenshot is saved', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('landing')).toBeVisible();
  expect(await page.evaluate('document.documentElement.dataset.jsReady')).toBe('true');
  await page.screenshot({ path: path.join(SCREENSHOTS, 'landing.png'), fullPage: true });
});
