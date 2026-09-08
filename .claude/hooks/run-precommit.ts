/**
 * Claude Code Stop hook: a turn may not end with the tree failing the guards.
 *
 * Reads the hook payload on stdin. Exit 2 blocks the stop and feeds the output
 * back as instructions; exit 0 lets the turn end. Runs the same commands the git
 * hook runs, over the whole tree (`npx tsx tasks.ts precommit`). Cross-platform (no shell).
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function readStdin(): string {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main(): number {
  let payload: { stop_hook_active?: boolean } = {};
  try {
    payload = JSON.parse(readStdin() || '{}') as { stop_hook_active?: boolean };
  } catch {
    payload = {};
  }
  if (payload.stop_hook_active === true) {
    return 0; // already retrying under this hook; do not loop
  }
  const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
  if (dirty.stdout.trim() === '') {
    return 0; // nothing changed, nothing to check
  }
  const tsx = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const result = spawnSync(process.execPath, [tsx, 'tasks.ts', 'precommit'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status === 0) {
    return 0;
  }
  if (result.error !== undefined) {
    console.error('tsx not installed; run node scripts/bootstrap-env.ts');
    return 0;
  }
  const tail = (result.stdout + result.stderr).split('\n').slice(-60).join('\n');
  console.error(
    'guards failed. Fix these before finishing (CLAUDE.md Definition of Done):\n' + tail,
  );
  return 2;
}

process.exitCode = main();
