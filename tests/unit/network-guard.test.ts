/** The runtime guard against network I/O inside an open transaction. */

import { expect, test } from 'vitest';

import {
  guardedFetch,
  guardNetworkIo,
  NetworkIoGuardViolation,
  trackTransaction,
  transactionDepth,
} from '../../app/utils/network-guard.js';

test('outside a transaction the guard is silent and depth is zero', () => {
  expect(transactionDepth()).toBe(0);
  expect(() => {
    guardNetworkIo('GET https://example.test');
  }).not.toThrow();
});

test('inside a tracked transaction, at any call depth, network I/O throws outside prod', async () => {
  await trackTransaction(async () => {
    expect(transactionDepth()).toBe(1);
    const deep = async (): Promise<void> => {
      await Promise.resolve();
      guardNetworkIo('POST https://example.test/hook');
    };
    await expect(deep()).rejects.toThrow(NetworkIoGuardViolation);
    await trackTransaction(async () => {
      await Promise.resolve();
      expect(transactionDepth()).toBe(2);
    });
    expect(transactionDepth()).toBe(1);
  });
  expect(transactionDepth()).toBe(0);
});

test('guardedFetch delegates to the wrapped fetch outside a transaction and refuses inside one', async () => {
  const calls: string[] = [];
  const fake = ((input: string | URL | Request) => {
    calls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    return Promise.resolve(new Response('ok'));
  }) as typeof fetch;
  const guarded = guardedFetch(fake);
  await guarded('https://example.test/a');
  expect(calls).toEqual(['https://example.test/a']);
  await trackTransaction(async () => {
    await expect(guarded('https://example.test/b', { method: 'PUT' })).rejects.toThrow(
      /PUT https:\/\/example.test\/b/,
    );
  });
  expect(calls).toHaveLength(1);
});
