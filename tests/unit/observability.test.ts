/** Correlation context, scrubbing, and named loggers that follow the configured root. */

import { expect, test } from 'vitest';

import {
  bind,
  currentContext,
  newCorrelationId,
  sanitizeCorrelationId,
} from '../../app/observability/context.js';
import { bindJobRun } from '../../app/observability/jobs.js';
import { createRootLogger, getLogger, setRootLogger } from '../../app/observability/logger.js';
import { REDACTED, scrub } from '../../app/observability/scrubbing.js';

function capture(secrets: readonly string[] = []): string[] {
  const lines: string[] = [];
  setRootLogger(
    createRootLogger({ level: 'info', json: true, secrets, sink: (line) => lines.push(line) }),
  );
  return lines;
}

test('bind layers fields for the duration of the callback and restores the outer context after', async () => {
  expect(currentContext()).toEqual({});
  await bind({ request_id: 'r1' }, async () => {
    expect(currentContext()).toEqual({ request_id: 'r1' });
    await bind({ job: 'nightly', skipped: undefined }, async () => {
      await Promise.resolve();
      expect(currentContext()).toEqual({ request_id: 'r1', job: 'nightly' });
    });
    expect(currentContext()).toEqual({ request_id: 'r1' });
  });
  expect(currentContext()).toEqual({});
});

test('correlation ids are 32 hex characters and inbound ids are constrained rather than trusted', () => {
  expect(newCorrelationId()).toMatch(/^[0-9a-f]{32}$/);
  expect(sanitizeCorrelationId('abc-123_x.y')).toBe('abc-123_x.y');
  expect(sanitizeCorrelationId('bad value')).toBeUndefined();
  expect(sanitizeCorrelationId('x'.repeat(65))).toBeUndefined();
  expect(sanitizeCorrelationId(undefined)).toBeUndefined();
});

test('scrub replaces every known secret and leaves other text alone', () => {
  expect(
    scrub('key=hunter2 url=postgresql://u:hunter2@h/db', [
      'postgresql://u:hunter2@h/db',
      'hunter2',
    ]),
  ).toBe(`key=${REDACTED} url=${REDACTED}`);
  expect(scrub('nothing here', ['hunter2'])).toBe('nothing here');
});

test('a named logger created before configuration writes through the new root with bound context and scrubbing', () => {
  const log = getLogger('tests.observability');
  const lines = capture(['hunter2']);
  bind({ request_id: 'req-9' }, () => {
    log.info({ extra: 1 }, 'password is hunter2');
  });
  expect(lines).toHaveLength(1);
  const record = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
  expect(record.message).toBe(`password is ${REDACTED}`);
  expect(record.request_id).toBe('req-9');
  expect(record.logger).toBe('tests.observability');
  expect(record.level).toBe('info');
  expect(record.extra).toBe(1);
  expect(typeof record.ts).toBe('string');
});

test('bindJobRun logs the outcome and duration, returns the result, and re-raises failures', async () => {
  const lines = capture();
  const result = await bindJobRun('nightly', async (runId) => {
    expect(currentContext()).toMatchObject({ job: 'nightly', run_id: runId });
    return 7;
  });
  expect(result).toBe(7);
  await expect(bindJobRun('nightly', () => Promise.reject(new Error('boom')))).rejects.toThrow(
    'boom',
  );
  const records = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
  expect(records.map((r) => r.outcome)).toEqual(['succeeded', 'failed']);
  expect(records.every((r) => typeof r.duration_ms === 'number' && r.job === 'nightly')).toBe(true);
});
