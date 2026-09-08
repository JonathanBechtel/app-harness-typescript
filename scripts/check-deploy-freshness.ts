/**
 * Report how far a deployment has fallen behind its source branch.
 *
 * Failure this descends from: production ran a 3.5-day-old image through an
 * incident whose fixes were merged and simply not running, and nothing reported
 * the difference. Deploys are manual; staleness nobody measures does not announce
 * itself.
 *
 * The image carries `RELEASE_SHA` (Dockerfile `--build-arg GIT_SHA`) and
 * `/health` reports it, so this needs no platform credentials: fetch the
 * health payload, compare the sha to `--against`, and fail if it is behind by
 * more than `--max-age-hours`. Never writes. `--report-only` observes without
 * failing.
 */

import { parseArgs } from 'node:util';

import { git, GitError, isMain } from './_check-runner.js';

export async function fetchReleaseSha(url: string): Promise<string | undefined> {
  const response = await fetch(`${url.replace(/\/+$/, '')}/health`, {
    signal: AbortSignal.timeout(15_000),
  });
  const payload = (await response.json()) as { releaseSha?: string | null };
  return payload.releaseSha === null ||
    payload.releaseSha === undefined ||
    payload.releaseSha === ''
    ? undefined
    : payload.releaseSha;
}

export function commitTime(sha: string): Date {
  return new Date(git(['show', '-s', '--format=%cI', sha]).trim());
}

export function commitsBehind(sha: string, ref: string): number {
  return Number(git(['rev-list', '--count', `${sha}..${ref}`]).trim() || '0');
}

interface Drift {
  readonly behind: number;
  readonly hoursBehind: number;
}

function measureDrift(sha: string, against: string): Drift | undefined {
  try {
    const behind = commitsBehind(sha, against);
    const hoursBehind =
      behind === 0 ? 0 : (commitTime(against).getTime() - commitTime(sha).getTime()) / 3_600_000;
    return { behind, hoursBehind };
  } catch (error) {
    if (error instanceof GitError) {
      return undefined;
    }
    throw error;
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      url: { type: 'string' },
      against: { type: 'string', default: 'origin/main' },
      'max-age-hours': { type: 'string', default: '48' },
      'report-only': { type: 'boolean', default: false },
    },
  });
  if (values.url === undefined) {
    console.error('--url is required');
    return 2;
  }
  const maxAge = Number(values['max-age-hours']);
  const soft = values['report-only'];
  const sha = await fetchReleaseSha(values.url);
  if (sha === undefined) {
    console.error(
      `deploy freshness: ${values.url} reports no releaseSha; the image was built without GIT_SHA`,
    );
    return soft ? 0 : 1;
  }
  const drift = measureDrift(sha, values.against);
  if (drift === undefined) {
    console.error(
      `deploy freshness: deployed sha ${sha} is unknown to this checkout (fetch --unshallow?)`,
    );
    return soft ? 0 : 1;
  }
  console.log(
    `deployed=${sha.slice(0, 12)} behind ${values.against} by ${drift.behind} commit(s), ${drift.hoursBehind.toFixed(1)}h (checked ${new Date().toISOString().slice(0, 16)})`,
  );
  if (drift.behind > 0 && drift.hoursBehind > maxAge && !soft) {
    console.error(`deploy freshness: STALE (> ${maxAge}h behind)`);
    return 1;
  }
  return 0;
}

if (isMain(import.meta)) {
  process.exitCode = await main(process.argv.slice(2));
}
