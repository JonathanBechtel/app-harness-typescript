/**
 * Provision a clean machine to CI parity, on Windows, macOS, or Linux.
 *
 * Installs dependencies (npm ci), starts (or adopts) a local Postgres on :5439
 * via Docker, writes a credential-free `.env`, applies migrations, installs the
 * git hooks, and runs the unit-test smoke check. Idempotent; never overwrites an
 * existing `.env`. Exits non-zero if the smoke check fails, because an automated
 * caller cannot otherwise tell a usable environment from one whose own
 * verification failed.
 *
 * Self-contained on purpose: it runs BEFORE node_modules exists, under Node's
 * built-in type stripping (Node >= 22.18), so it imports nothing local.
 *
 *     node scripts/bootstrap-env.ts                 # everything
 *     node scripts/bootstrap-env.ts --skip-db       # toolchain only
 *     node scripts/bootstrap-env.ts --with-browsers # also install Chromium
 */

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IS_WINDOWS = process.platform === 'win32';
const PG_PORT = Number(process.env.BOOTSTRAP_PG_PORT ?? '5439');
const PG_CONTAINER = process.env.BOOTSTRAP_PG_CONTAINER ?? 'app-harness-pg';
const PG_IMAGE = 'postgres:16';
const PG_BASE = `postgresql://postgres:postgres@localhost:${PG_PORT}`;
const NPM = IS_WINDOWS ? 'npm.cmd' : 'npm';

function log(message: string): void {
  console.log(`\n==> ${message}`);
}

function warn(message: string): void {
  console.error(`warning: ${message}`);
}

function die(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

function run(
  cmd: string,
  args: string[],
  options: { check?: boolean; capture?: boolean } = {},
): { code: number; stdout: string } {
  const result = spawnSync(cmd, args, {
    cwd: REPO,
    encoding: 'utf8',
    stdio: options.capture === true ? 'pipe' : 'inherit',
    shell: IS_WINDOWS && cmd.endsWith('.cmd'),
  });
  const code = result.status ?? 1;
  if ((options.check ?? true) && code !== 0) {
    die(`${cmd} ${args.join(' ')} failed (${code})`);
  }
  return { code, stdout: result.stdout ?? '' };
}

function checkNode(): void {
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 18)) {
    die(`Node >= 22.18 required; running ${process.versions.node}`);
  }
  console.log(`using node ${process.versions.node}`);
}

function install(): void {
  log('Installing dependencies (npm ci)');
  run(NPM, [
    existsSync(path.join(REPO, 'package-lock.json')) ? 'ci' : 'install',
    '--no-audit',
    '--no-fund',
  ]);
  console.log('installed');
}

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    const fail = (): void => {
      socket.destroy();
      resolve(false);
    };
    socket.once('error', fail);
    socket.once('timeout', fail);
  });
}

function dockerAvailable(): boolean {
  return run('docker', ['info'], { check: false, capture: true }).code === 0;
}

async function startPostgres(): Promise<void> {
  log(`Postgres on :${PG_PORT}`);
  if (!dockerAvailable()) {
    warn('Docker is unavailable; looking for a Postgres already on the port');
    return;
  }
  const names = run('docker', ['ps', '-a', '--format', '{{.Names}}'], {
    capture: true,
  }).stdout.split(/\s+/);
  if (names.includes(PG_CONTAINER)) {
    run('docker', ['start', PG_CONTAINER], { capture: true });
    console.log(`started existing container ${PG_CONTAINER}`);
  } else if (await portOpen(PG_PORT)) {
    console.log(`adopting the Postgres already listening on :${PG_PORT}`);
  } else {
    run(
      'docker',
      [
        'run',
        '-d',
        '--name',
        PG_CONTAINER,
        '-e',
        'POSTGRES_USER=postgres',
        '-e',
        'POSTGRES_PASSWORD=postgres',
        '-e',
        'POSTGRES_DB=app',
        '-p',
        `${PG_PORT}:5432`,
        PG_IMAGE,
      ],
      { capture: true },
    );
    console.log(`created container ${PG_CONTAINER}`);
  }
}

/** Create app + app_test through the postgres driver (installed by now); true on success. */
async function createDatabases(): Promise<boolean> {
  const { default: postgres } = (await import(
    path.join(REPO, 'node_modules', 'postgres', 'src', 'index.js')
  )) as {
    default: (
      url: string,
      opts: Record<string, unknown>,
    ) => { unsafe: (q: string) => Promise<{ length: number }>; end: () => Promise<void> };
  };
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const client = postgres(`${PG_BASE}/postgres`, {
      max: 1,
      connect_timeout: 3,
      onnotice: () => undefined,
    });
    try {
      for (const db of ['app', 'app_test']) {
        const rows = await client.unsafe(`SELECT 1 FROM pg_database WHERE datname = '${db}'`);
        if (rows.length === 0) {
          await client.unsafe(`CREATE DATABASE "${db}"`);
          console.log(`created database ${db}`);
        } else {
          console.log(`database ${db} already present`);
        }
      }
      await client.end();
      return true;
    } catch {
      await client.end().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  console.error(`no Postgres answered on :${PG_PORT} within 60s`);
  return false;
}

function writeEnv(appUrl: string, testUrl: string, dbReady: boolean): void {
  log('Environment file');
  const envPath = path.join(REPO, '.env');
  if (existsSync(envPath)) {
    console.log('.env already exists -- left untouched');
    return;
  }
  writeFileSync(
    envPath,
    '# Generated by scripts/bootstrap-env.ts -- sandbox-safe, no real credentials.\n' +
      'APP_ENV=dev\nDEBUG=1\nLOG_LEVEL=info\n' +
      `SECRET_KEY=${randomBytes(32).toString('base64url')}\n` +
      `DATABASE_URL=${appUrl}\nTEST_DATABASE_URL=${testUrl}\n` +
      `TEST_ALLOW_DB=1\nTEST_REQUIRE_DB=${dbReady ? 1 : 0}\nANTHROPIC_API_KEY=\n`,
  );
  console.log('wrote .env');
}

function tsx(args: string[], options: { check?: boolean } = {}): number {
  return run(
    process.execPath,
    [path.join(REPO, 'node_modules', 'tsx', 'dist', 'cli.mjs'), ...args],
    options,
  ).code;
}

async function main(): Promise<number> {
  const args = new Set(process.argv.slice(2));
  log('Node toolchain');
  checkNode();
  install();

  let dbReady = false;
  let appUrl = `${PG_BASE}/app`;
  let testUrl = `${PG_BASE}/app_test`;
  if (args.has('--skip-db')) {
    log('Skipping database (--skip-db)');
  } else if (process.env.TEST_DATABASE_URL !== undefined && process.env.TEST_DATABASE_URL !== '') {
    log('Using the TEST_DATABASE_URL already set in this environment');
    testUrl = process.env.TEST_DATABASE_URL;
    appUrl = process.env.DATABASE_URL ?? testUrl;
    dbReady = true;
  } else {
    await startPostgres();
    dbReady = await createDatabases();
    if (!dbReady) {
      warn(
        'No Postgres provisioned. Unit tests and static checks still work; integration tests need TEST_DATABASE_URL.',
      );
    }
  }

  writeEnv(appUrl, testUrl, dbReady);

  if (dbReady) {
    log('Applying migrations');
    tsx(['app/cli/migrate.ts']);
  }

  log('Installing git hooks (husky)');
  run(NPM, ['run', 'prepare', '--silent'], { check: false });
  console.log('hooks installed');

  if (args.has('--with-browsers')) {
    log('Installing Playwright Chromium');
    if (
      run(
        process.execPath,
        [
          path.join(REPO, 'node_modules', 'playwright', 'cli.js'),
          'install',
          '--with-deps',
          'chromium',
        ],
        { check: false },
      ).code !== 0
    ) {
      run(process.execPath, [
        path.join(REPO, 'node_modules', 'playwright', 'cli.js'),
        'install',
        'chromium',
      ]);
    }
  }

  log('Smoke check (unit tests)');
  if (
    run(
      process.execPath,
      [
        path.join(REPO, 'node_modules', 'vitest', 'vitest.mjs'),
        'run',
        '--project',
        'unit',
        '--bail',
        '1',
      ],
      { check: false },
    ).code !== 0
  ) {
    die('environment installed but the smoke check failed');
  }

  console.log('\n==> Bootstrap complete\n');
  console.log(
    'Working now:\n' +
      '  npm run checks            every static check CI runs\n' +
      '  npm run test              unit tests\n' +
      '  npm run test.integration  (if a database was provisioned)\n' +
      '  npm run dev               server on :8000\n\n' +
      'Needs credentials or a human: evals (provider keys), test.e2e (a running server +\n' +
      '--with-browsers), deploys (Azure / Databricks auth).',
  );
  return 0;
}

process.exitCode = await main();
