// Local guardrails, run on staged files by .husky/pre-commit. Every entry here is
// mirrored EXACTLY in tasks.ts and in .github/workflows/ci.yml, so a violation
// cannot pass locally and fail in CI, or the reverse. Hooks are bypassable
// (--no-verify, a clone without hooks); CI is the enforcing copy.
//
// Two families of entry:
//   * path-taking checkers receive the staged files (string form appends them);
//   * whole-tree / diff-scoped checkers use the function form, which drops the
//     filenames, because the property they check is not a property of one file.
// Both refuse to pass on an empty scan (scripts/_check-runner.ts).
const whole = (cmd) => () => cmd;

export default {
  '*.{ts,js,cjs,mjs,json,yml,yaml}': ['prettier --write'],
  '{app,scripts,tests,evals}/**/*.ts': ['eslint --fix', whole('tsx tasks.ts typecheck')],
  'tasks.ts': ['eslint --fix', whole('tsx tasks.ts typecheck')],
  'app/**/*.ts': [
    whole('tsx tasks.ts lint.imports'),
    whole('tsx scripts/check-complexity-ratchet.ts'),
    whole('tsx scripts/check-runtime-entrypoints.ts'),
    whole('tsx scripts/check-docs-freshness.ts'),
    whole('tsx scripts/check-file-size-ratchet.ts'),
    whole('tsx scripts/check-duplicate-code.ts'),
  ],
  'app/{api,web}/**/*.ts': ['tsx scripts/check-route-conventions.ts'],
  'app/templates/**/*.njk': ['tsx scripts/check-route-conventions.ts'],
  'app/{api,web,services}/**/*.ts': ['tsx scripts/check-request-transaction-policy.ts'],
  '{app,scripts}/**/*.ts': [
    'tsx scripts/check-unscoped-delete.ts',
    'tsx scripts/check-module-conventions.ts',
    whole('tsx scripts/check-complexity-ratchet.ts'),
    whole('tsx scripts/check-duplicate-code.ts'),
  ],
  '{app,tests}/**/*.ts': ['tsx scripts/check-empty-method-stubs.ts'],
  '.module-conventions.yml': [whole('tsx scripts/check-module-conventions.ts --all')],
  '{deploy/**,.github/workflows/*.yml,.dockerignore,Dockerfile}': [
    whole('tsx scripts/check-runtime-entrypoints.ts'),
  ],
  '{CLAUDE.md,docs/**/*.md}': [whole('tsx scripts/check-docs-freshness.ts')],
  'app/migrations/**': [whole('tsx scripts/check-migration-safety.ts')],
  'app/cli/migrate.ts': [whole('tsx scripts/check-migration-safety.ts')],
  'tests/**/*.ts': [
    whole('tsx scripts/check-test-float-comparisons.ts'),
    whole('tsx scripts/check-test-titles.ts'),
  ],
};
