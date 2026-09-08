/** Every budgeted route stays within its statement count. */

import { BUDGETS } from './budgets.js';
import { expect, test } from '../fixtures.js';

for (const route of Object.keys(BUDGETS).sort()) {
  test(`rendering ${route} issues no more SQL statements than its budget allows`, async ({
    appClient,
    statements,
  }) => {
    statements.length = 0;
    const response = await appClient.inject({ method: 'GET', url: route });
    expect(response.statusCode).toBeLessThan(500);
    const budget = BUDGETS[route] ?? 0;
    expect(
      statements.length,
      `${route} issued ${statements.length} statements (budget ${budget}). See budgets.ts for the protocol.\n${statements.join('\n')}`,
    ).toBeLessThanOrEqual(budget);
  });
}
