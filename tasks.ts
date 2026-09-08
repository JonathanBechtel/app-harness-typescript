/**
 * Cross-platform task runner: the single definition of every project task.
 *
 *     npm run <task> [-- KEY=VALUE ...]        # any OS (package.json scripts are a thin shim)
 *     npx tsx tasks.ts <task> [KEY=VALUE ...]  # the same, without the shim
 *
 * Why a TypeScript file and not package.json scripts alone: the team runs
 * Windows, macOS and Linux, and npm scripts go through a shell whose quoting,
 * globbing and `&&` differ per platform. Every task here is a list of process
 * arguments (no shell) resolved to the JavaScript entry of each tool, so it
 * behaves identically everywhere.
 *
 * Every guard task is mirrored in lint-staged.config.js and .github/workflows/ci.yml
 * with identical scope; tests/unit/guard-wiring.test.ts asserts they agree.
 */

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.dirname(fileURLToPath(import.meta.url));
// `npm run help | head` must not crash on a closed pipe.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') {
    process.exit(0);
  }
});
const NODE = process.execPath;
export type Params = Readonly<Record<string, string>>;
type TaskFn = (params: Params) => number;

export interface Task {
  readonly name: string;
  readonly help: string;
  readonly fn: TaskFn;
}

export const TASKS = new Map<string, Task>();

function task(name: string, help: string, fn: TaskFn): void {
  TASKS.set(name, { name, help, fn });
}

// ---------------------------------------------------------------- helpers

/** JavaScript entry point of an installed CLI, run as `node <entry>` (no shell, no .cmd shims). */
export function bin(pkg: string, command: string = pkg): string[] {
  const manifest = JSON.parse(
    readFileSync(path.join(REPO, 'node_modules', pkg, 'package.json'), 'utf8'),
  ) as {
    bin?: string | Record<string, string>;
  };
  const entry = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[command];
  if (entry === undefined) {
    throw new Error(`no bin '${command}' in package ${pkg}`);
  }
  return [NODE, path.join(REPO, 'node_modules', pkg, entry)];
}

const tsx = (): string[] => bin('tsx');

class TaskFailed extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}

/** Run a command from the repo root, streaming output; return its exit code. */
export function run(
  cmd: readonly string[],
  options: { env?: Record<string, string>; check?: boolean } = {},
): number {
  const [exe = '', ...args] = cmd;
  console.log(`$ ${cmd.map((c) => (c === NODE ? 'node' : path.relative(REPO, c) || c)).join(' ')}`);
  const result = spawnSync(exe, args, {
    cwd: REPO,
    stdio: 'inherit',
    env: { ...process.env, ...options.env },
  });
  const code = result.status ?? 1;
  if ((options.check ?? true) && code !== 0) {
    throw new TaskFailed(code);
  }
  return code;
}

function runAll(...cmds: (readonly string[])[]): number {
  for (const cmd of cmds) {
    run(cmd);
  }
  return 0;
}

function param(params: Params, key: string, fallback: string): string {
  const value = params[key] ?? process.env[key];
  return value === undefined || value === '' ? fallback : value;
}

function required(params: Params, key: string, hint: string): string {
  const value = param(params, key, '');
  if (value === '') {
    console.error(`[error] set ${key}=${hint}`);
    throw new TaskFailed(2);
  }
  return value;
}

function gitSha(): string {
  const out = spawnSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], {
    cwd: REPO,
    encoding: 'utf8',
  });
  return out.stdout.trim() || 'local';
}

function script(name: string, ...args: string[]): string[] {
  return [...tsx(), `scripts/${name}.ts`, ...args];
}

const against = (params: Params): string[] => ['--against', param(params, 'BASE', 'origin/main')];

// ---------------------------------------------------------------- setup / run

task('help', 'List tasks', () => {
  const width = Math.max(...[...TASKS.keys()].map((n) => n.length));
  console.log(
    'Usage: npm run <task> [-- KEY=VALUE ...]   (or: npx tsx tasks.ts <task> [KEY=VALUE ...])\n',
  );
  for (const t of TASKS.values()) {
    console.log(`  ${t.name.padEnd(width)}  ${t.help}`);
  }
  return 0;
});

task(
  'bootstrap',
  'Provision a clean machine to CI parity (deps, Postgres, .env, hooks)',
  (params) =>
    run([
      NODE,
      'scripts/bootstrap-env.ts',
      ...(params._positional ?? '').split(' ').filter((a) => a !== ''),
    ]),
);

task('dev', 'Start the server with autoreload (HOST, PORT)', (params) =>
  run([...tsx(), 'watch', 'app/main.ts'], {
    env: { HOST: param(params, 'HOST', '0.0.0.0'), PORT: param(params, 'PORT', '8000') },
  }),
);

task('run', 'Start the server without reload (production-like, from source)', (params) =>
  run([...tsx(), 'app/main.ts'], {
    env: { HOST: param(params, 'HOST', '0.0.0.0'), PORT: param(params, 'PORT', '8000') },
  }),
);

task('build', 'Compile app/ to dist/ and copy templates, static, migrations, data', () => {
  rmSync(path.join(REPO, 'dist'), { recursive: true, force: true });
  run([...bin('typescript', 'tsc'), '-p', 'tsconfig.build.json']);
  for (const dir of ['templates', 'static', 'migrations', 'data']) {
    const src = path.join(REPO, 'app', dir);
    if (existsSync(src)) {
      cpSync(src, path.join(REPO, 'dist', 'app', dir), { recursive: true });
    }
  }
  console.log('built dist/');
  return 0;
});

// ---------------------------------------------------------------- lint / type

task('fmt', 'Format with prettier', () => run([...bin('prettier'), '--write', '.']));
task('fmt.check', 'Verify formatting (CI runs exactly this)', () =>
  run([...bin('prettier'), '--check', '.']),
);
task('lint', 'Lint with eslint', () => run([...bin('eslint'), '.']));
task('fix', 'Apply eslint autofixes', () => run([...bin('eslint'), '--fix', '.']));
task('typecheck', 'tsc over app, scripts, tests, evals (CI runs exactly this)', () =>
  run([...bin('typescript', 'tsc'), '--noEmit', '-p', 'tsconfig.json']),
);
task(
  'precommit',
  'Run every guard over the whole tree (what lint-staged runs on staged files)',
  (params) => {
    TASKS.get('fmt.check')?.fn(params);
    TASKS.get('checks')?.fn(params);
    return TASKS.get('checks.diff')?.fn({ ...params, BASE: param(params, 'BASE', 'HEAD') }) ?? 0;
  },
);

// ---------------------------------------------------------------- guards

task('lint.imports', 'Structural import contracts (.dependency-cruiser.cjs)', () =>
  run([...bin('dependency-cruiser', 'depcruise'), '--config', '.dependency-cruiser.cjs', 'app']),
);
task(
  'lint.complexity',
  'Per-file complexity ratchet vs complexity-baseline.json (counts may only fall)',
  () => run(script('check-complexity-ratchet')),
);
task('lint.complexity.update', 'Rewrite the complexity baseline after simplifying code', () =>
  run(script('check-complexity-ratchet', '--update')),
);
task(
  'lint.filesize',
  'Diff-scoped file-size ratchet, enforced against BASE (default origin/main)',
  (params) => run(script('check-file-size-ratchet', ...against(params), '--enforce')),
);
task(
  'lint.filesize.report',
  'Waiver census: app/ files carrying a file-size waiver and their sizes',
  () => run(script('check-file-size-ratchet', '--report')),
);
task(
  'lint.migrations',
  'New revisions build indexes concurrently in no-transaction revisions; journal is linear',
  (params) => run(script('check-migration-safety', ...against(params))),
);
task(
  'lint.migrations.roundtrip',
  'Fresh database -> migrate -> migrate again (no-op) -> schema/revision drift check (ROUNDTRIP_DATABASE_URL must be disposable)',
  (params) => {
    const url = required(
      params,
      'ROUNDTRIP_DATABASE_URL',
      'postgresql://... (a DISPOSABLE database; this DROPs everything in it)',
    );
    const env = { DATABASE_URL: url, APP_ENV: 'stage' };
    run(script('reset-database'), { env });
    run([...tsx(), 'app/cli/migrate.ts'], { env });
    run([...tsx(), 'app/cli/migrate.ts'], { env });
    return run(script('check-migration-drift'));
  },
);
task('lint.duplication', 'Diff-scoped duplicate-code gate (jscpd, % of changed lines)', (params) =>
  run(script('check-duplicate-code', ...against(params))),
);
task('lint.test-titles', 'Changed tests must carry a descriptive title', (params) =>
  run(script('check-test-titles', ...against(params))),
);
task(
  'lint.test-float',
  'Changed test assertions must use toBeCloseTo for float equality',
  (params) => run(script('check-test-float-comparisons', ...against(params))),
);
task(
  'lint.entrypoints',
  'app/cli vs scripts/ boundary; app/ must not read .dockerignore-excluded paths',
  () => run(script('check-runtime-entrypoints')),
);
task('lint.modules', 'Directory-scoped module placement/naming (.module-conventions.yml)', () =>
  run(script('check-module-conventions', '--all')),
);
task(
  'lint.docs',
  'Agent docs describe the real app: no stale placeholders, every package documented',
  () => run(script('check-docs-freshness')),
);

task('checks', 'Every whole-tree static check CI runs (no DB, no diff base needed)', (params) => {
  for (const name of [
    'lint',
    'typecheck',
    'lint.imports',
    'lint.complexity',
    'lint.entrypoints',
    'lint.modules',
    'lint.docs',
  ]) {
    TASKS.get(name)?.fn(params);
  }
  return runAll(
    script('check-route-conventions', '--all'),
    script('check-request-transaction-policy', '--all'),
    script('check-unscoped-delete', '--all'),
    script('check-empty-method-stubs', '--all'),
  );
});

task('checks.diff', 'Every diff-scoped guard against BASE (default origin/main)', (params) => {
  for (const name of [
    'lint.filesize',
    'lint.migrations',
    'lint.duplication',
    'lint.test-titles',
    'lint.test-float',
  ]) {
    TASKS.get(name)?.fn(params);
  }
  return 0;
});

// ---------------------------------------------------------------- tests

const vitest = (): string[] => bin('vitest');

task('test', 'Fast default: unit tests only', (params) => TASKS.get('test.unit')?.fn(params) ?? 1);
task('test.unit', 'Unit tests (no database)', () => run([...vitest(), 'run', '--project', 'unit']));
task(
  'test.integration',
  'Integration tests (needs TEST_DATABASE_URL + TEST_ALLOW_DB=1 in .env)',
  () => run([...vitest(), 'run', '--project', 'integration']),
);
task(
  'test.e2e',
  'Browser tests against a running server (TEST_BASE_URL, default localhost:8000)',
  () => run([...bin('@playwright/test', 'playwright'), 'test']),
);
task('coverage', 'Unit + integration with terminal + HTML + lcov report', () => {
  const code = run([...vitest(), 'run', '--coverage']);
  console.log('HTML report: open coverage/index.html');
  return code;
});
task(
  'coverage.diff',
  'Patch-coverage gate: >=80% of changed app/ lines executed (BASE, FAIL_UNDER)',
  (params) => {
    run([
      ...vitest(),
      'run',
      '--coverage',
      '--coverage.reporter=lcov',
      '--coverage.reporter=text-summary',
    ]);
    return run(
      script(
        'check-patch-coverage',
        ...against(params),
        '--fail-under',
        param(params, 'FAIL_UNDER', '80'),
      ),
    );
  },
);
task('perf', 'Per-route query-count budgets (tests/integration/perf/budgets.ts)', () =>
  run([...vitest(), 'run', '--project', 'integration', 'tests/integration/perf']),
);
task('playwright.install', 'Install Chromium for e2e tests (once)', () =>
  run([...bin('playwright'), 'install', 'chromium']),
);

// ---------------------------------------------------------------- migrations

const drizzleKit = (): string[] => bin('drizzle-kit');

task(
  'mig.generate',
  'Generate a revision from app/models: npm run mig.generate -- m="add widgets"',
  (params) =>
    run([
      ...drizzleKit(),
      'generate',
      '--name',
      required(params, 'm', '"describe the change"')
        .replaceAll(/[^a-z0-9]+/gi, '-')
        .toLowerCase(),
    ]),
);
task('mig.up', 'Apply pending revisions (app/cli/migrate.ts)', () =>
  run([...tsx(), 'app/cli/migrate.ts']),
);
task('mig.status', 'List pending revisions', () =>
  run([...tsx(), 'app/cli/migrate.ts', '--status']),
);
task('mig.check', 'drizzle-kit check: revisions and snapshots are internally consistent', () =>
  run([...drizzleKit(), 'check']),
);

// ---------------------------------------------------------------- container / deploy

task('docker.build', 'Build the deployable image (IMAGE, default app-harness:local)', (params) =>
  run([
    'docker',
    'build',
    '--build-arg',
    `GIT_SHA=${gitSha()}`,
    '-t',
    param(params, 'IMAGE', 'app-harness:local'),
    '.',
  ]),
);
task('docker.run', 'Run the built image locally on :8000 with .env', (params) =>
  run([
    'docker',
    'run',
    '--rm',
    '--env-file',
    '.env',
    '-e',
    'APP_ENV=stage',
    '-p',
    '8000:8000',
    param(params, 'IMAGE', 'app-harness:local'),
  ]),
);
task('docker.up', 'docker compose up (Postgres + app)', () =>
  run(['docker', 'compose', 'up', '--build']),
);
task('docker.down', 'docker compose down', () => run(['docker', 'compose', 'down']));
task(
  'deploy.freshness',
  'How far behind BASE is the deployment at DEPLOY_URL? (reads /health)',
  (params) =>
    run(
      script(
        'check-deploy-freshness',
        '--url',
        required(params, 'DEPLOY_URL', 'https://your-app.example.com'),
        ...against(params),
      ),
    ),
);

// ---------------------------------------------------------------- evals

task(
  'evals',
  'Run the LLM eval suite (SUITE, default core); real suites need provider credentials',
  (params) => run([...tsx(), 'evals/runner.ts', '--suite', param(params, 'SUITE', 'core')]),
);

// ---------------------------------------------------------------- entrypoint

/** `<task> KEY=VALUE ... [positional...]` -> [task, params]. */
export function parse(argv: readonly string[]): [string, Params] {
  const [name, ...rest] = argv;
  if (name === undefined || name === '-h' || name === '--help') {
    return ['help', {}];
  }
  const params: Record<string, string> = {};
  const positional: string[] = [];
  for (const arg of rest) {
    const eq = arg.indexOf('=');
    const key = eq === -1 ? '' : arg.slice(0, eq);
    if (eq !== -1 && /^[A-Za-z0-9_-]+$/.test(key)) {
      params[key] = arg.slice(eq + 1);
    } else {
      positional.push(arg);
    }
  }
  params._positional = positional.join(' ');
  return [name, params];
}

export function main(argv: readonly string[]): number {
  const [name, params] = parse(argv);
  const found = TASKS.get(name);
  if (found === undefined) {
    console.error(`unknown task '${name}'. Run \`npm run help\`.`);
    return 2;
  }
  try {
    return found.fn(params);
  } catch (error) {
    if (error instanceof TaskFailed) {
      return error.code;
    }
    throw error;
  }
}

const entry = process.argv[1];
if (entry !== undefined && path.resolve(entry) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
