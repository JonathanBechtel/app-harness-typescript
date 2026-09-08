# Testing

## Tiers

| Tier | Where | Needs | Runs in CI | Purpose |
|---|---|---|---|---|
| unit | `tests/unit` | nothing (the database driver is mocked to throw) | yes | pure logic, guard meta-tests, reflective checks |
| integration | `tests/integration` | Postgres (`TEST_DATABASE_URL`, `TEST_ALLOW_DB=1`) | yes (service container) | routes via `app.inject()` + database state; the primary signal |
| perf | `tests/integration/perf` | Postgres | yes | per-route SQL statement budgets |
| e2e | `tests/e2e` (`npm run test.e2e`) | a running server + Chromium (`npm run playwright.install`; on an OS outside Playwright's support window set `PLAYWRIGHT_CHANNEL=chrome` to drive the system Chrome) | manual | a browser proves JS actually ran; screenshots for a human/agent to read |
| evals | `evals/` | provider credentials | manual | LLM answer quality; not a software test |

## The database gate

`tests/integration/gate.ts` requires explicit opt-in (`TEST_ALLOW_DB=1`) and a URL that is not the app database. With `TEST_REQUIRE_DB=1` (set by CI and by bootstrap) a missing URL is a **failure** at config time, not a skip: an unprovisioned box exiting 0 with everything skipped is indistinguishable from green.

Isolation: one random schema per run, tables created by applying the repo's own revisions into it, dropped afterwards. The `tx` fixture runs a test inside a rolled-back transaction; the `db`/`sql`/`appClient` fixtures use real commits and truncate every table afterwards.

## Habits that hold up

- Write the integration test first; add unit tests for pure edge cases.
- Assert behaviour: status codes, rows created, payload shapes — not internals.
- Factories over seed dumps; small deterministic fixtures.
- A descriptive title on every test (enforced on changed tests); `toBeCloseTo` for floats (enforced).
- Never mock the database in an integration test; mock at the external boundary (HTTP client, provider `ModelClient`).
- A green suite with a skipped tier is not green. Report skips.

## Coverage

CI enforces ≥80% **patch** coverage on changed `app/` lines (`scripts/check-patch-coverage.ts` over vitest's lcov). Whole-project coverage is reported, not gated, so legacy debt never blocks a fix. `npm run coverage.diff` runs the same gate locally.

## Meta-tests

Every guard script has a test that seeds its original failure and asserts it fires (`tests/unit/check-*.test.ts`). CI runs them without coverage instrumentation: whole-tree scans are slower under it and measure no `app/` code.
