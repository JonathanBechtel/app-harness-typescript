/** The client seam: the fake records every call so tests and evals can assert usage. */

import { expect, test } from 'vitest';

import { FakeModelClient } from '../../app/ai/client.js';

test('FakeModelClient echoes by default and records a zero-cost call per completion', async () => {
  const client = new FakeModelClient();
  const completion = await client.complete({ role: 'summarizer', system: '', prompt: 'ping' });
  expect(completion.text).toBe('echo: ping');
  expect(completion.record).toMatchObject({
    role: 'summarizer',
    provider: 'fake',
    model: 'fake',
    inputTokens: 4,
    cacheReadTokens: 0,
  });
  expect(client.calls).toHaveLength(1);
});

test('a custom responder drives the reply so services can be tested against canned model output', async () => {
  const client = new FakeModelClient((prompt) => prompt.toUpperCase());
  expect((await client.complete({ role: 'x', system: 's', prompt: 'abc' })).text).toBe('ABC');
});
