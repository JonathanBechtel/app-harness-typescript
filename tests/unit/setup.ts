/**
 * Unit tests never touch a database. The mock below makes that mechanical: the
 * `postgres` driver is replaced by a client whose every query throws, so a unit
 * test that reaches the database fails fast with a pointer to tests/integration.
 */

import { vi } from 'vitest';

vi.mock('postgres', () => {
  const boom = (): never => {
    throw new Error('unit tests must not connect to a database; use tests/integration');
  };
  const fake = (): unknown => {
    const client = Object.assign(boom, {
      options: { parsers: {}, serializers: {} },
      unsafe: boom,
      begin: boom,
      reserve: boom,
      end: () => Promise.resolve(),
    });
    return client;
  };
  return { default: fake };
});
