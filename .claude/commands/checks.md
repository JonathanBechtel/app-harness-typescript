Run the full Definition of Done from CLAUDE.md and fix anything that fails:

1. `npm run checks` (eslint, tsc, dependency-cruiser, complexity ratchet, entrypoint boundary, module conventions, docs freshness, route/transaction/delete/stub guards)
2. `npm run checks.diff` (file size, migrations, duplication, test titles, float comparisons; diff-scoped against origin/main)
3. `npm run test.unit`; `npm run test.integration` if a database is configured (`.env`), and `npm run coverage.diff` for the patch-coverage gate.
4. For UI changes: `npm run test.e2e` against `npm run dev` and read the screenshots.

Do not ask whether to run these; run them, fix failures, then report what ran and what was skipped (and why).
