# Agent instructions — read this first

This file is the single source of project instructions for every AI agent and every engineer. `AGENTS.md` and `GEMINI.md` point here. Per-package rules live in each package's own `CLAUDE.md`; read the nearest one before editing a file.

## What this repository is

<!-- template:placeholder -->
> **Template placeholder — replace with the truth about this application.** This repository was created from the *app-harness-typescript* template: a Fastify service skeleton carrying the organisation's engineering guardrails, test harness, deploy pipeline, and agent documentation. Until this section is rewritten, the app is the template. Describe: the product and its users, the domain vocabulary, the external systems, the deploy targets in use, and what "done" means for this project's UI (if it has one). Then delete this blockquote. `npm run lint.docs` fails while placeholders remain once real code exists.

**Purpose:** _one paragraph._

**Users:** _who, and what they need from it._

**Not in scope:** _what this app deliberately does not do._

## Your obligations to the next agent

The next agent will read this file to learn how the app works. Keep it true:

1. **Docs change with the code, in the same PR.** New package → its `CLAUDE.md` and a row in `app/CLAUDE.md`. New route, job, setting, or integration → the relevant section here and `.env.example`. New convention → the package `CLAUDE.md` and, if mechanisable, a guard (`/add-guard`).
2. **Record decisions** in `docs/decisions/` when you choose a library, draw a boundary, or adopt a pattern. Future you needs the *why*.
3. **Run `npm run lint.docs`** before finishing; it fails on undocumented packages, stale template placeholders, and references to tasks that do not exist. The `/update-docs` skill walks the full procedure.
4. **Do not paper over a failing guard.** Every guard has a `// discipline: <rule> <reason>` escape hatch; use it with a real reason visible in review, never `--no-verify`.

## Definition of Done

No task is complete until these pass. Run them proactively; do not ask whether to. Every `npm run <task>` below is equivalently `npx tsx tasks.ts <task>`; parameters go after `--` (`npm run lint.filesize -- BASE=main`).

1. `npm run checks` — eslint, tsc over everything, import contracts, complexity ratchet, entrypoint boundary, module conventions, docs freshness, and the route/transaction/delete/stub guards.
2. `npm run checks.diff` — the diff-scoped guards (file size, migrations, duplication, test titles, float comparisons) against `origin/main` (CI enforces them against the PR base).
3. `npm run test.unit`; `npm run test.integration` when a database is available; `npm run coverage.diff` (≥80% of changed `app/` lines executed — CI fails below it).
4. UI changes: `npm run test.e2e` against `npm run dev`, then read the screenshots in `tests/e2e/screenshots/`.
5. Prompt or model changes: `npm run evals` and paste the score into the PR.

The git hooks only see staged files; CI checks the whole tree, so run the tasks, not just the hooks. If an environment cannot run a step (no database, no browser, no credentials), say so explicitly rather than reporting it as passed. `node scripts/bootstrap-env.ts` provisions a clean machine to CI parity.

## Layout and boundaries

```
app/       shipped package — see app/CLAUDE.md for the layer table and import rules
scripts/   operator tooling + guard scripts; never shipped, never imported by app/
tests/     unit (no DB) · integration (Postgres) · e2e (browser) · perf budgets · guard meta-tests
evals/     LLM quality benchmarks, on demand
docs/      architecture · decisions · guides · plans · runbooks (docs/CLAUDE.md)
deploy/    target adapters; the image is the artifact (deploy/README.md)
```

**Executable code lives in two places.** If the deployed container runs it, it is `app/cli/<job>.ts` invoked as `node dist/app/cli/<job>.js`. If a human or CI runs it from a checkout, it is `scripts/`. Nothing under `app/` imports or reads from `scripts/`, `tests/`, `docs/`, `deploy/`, or `evals/` (they are absent from the image). Enforced by `scripts/check-runtime-entrypoints.ts` and dependency-cruiser contract 6.

## Tech stack

Node 22 · TypeScript 5 (strict, ESM) · Fastify · Zod · Drizzle ORM + drizzle-kit · Postgres (postgres.js) · pino · Nunjucks + vanilla CSS/JS (optional web layer, no build step) · Vitest · Playwright · ESLint + Prettier · dependency-cruiser · husky + lint-staged · Docker. Cross-platform: tasks are TypeScript (`tasks.ts`, no shell), hooks are TypeScript; Windows, macOS and Linux are all first-class. The whole stack is present in every project, whether it uses the web layer or LLM features or neither. See `docs/decisions/`.

## Conventions

**Config.** All environment is read once in `app/config.ts` (`settings`). Every field is documented in `.env.example`; every credential-shaped field is in the log-scrubbing list. Never read `process.env` elsewhere for app config; never commit `.env`.

**API.** Thin route plugins; the database via `app.db`; `schema.response` on every route; explicit numeric status codes on writes; transactions via `withTransaction(app.db, async (tx) => ...)`. Details: `app/api/CLAUDE.md`.

**Services / repositories / models.** Services own logic and transaction boundaries, repositories own row access, models are the schema. Routers never import repositories. No network I/O inside an open transaction (runtime-guarded). `db.delete(table)` always has a `.where(...)`.

**Naming.** `camelCase` functions and variables, `PascalCase` types and classes, `UPPER_SNAKE_CASE` constants and enum members. Files: kebab-case, `<domain>-service.ts`, `<domain>-repository.ts`, `<domain>-utils.ts`. JSDoc on public functions (format is linted); a descriptive title on every test.

**Typing.** Validate at boundaries (Zod); strong types inside. Narrow with type guards and early return, don't `as`. No `any`. `npm run typecheck` must be clean — it covers `app/`, `scripts/`, `tests/`, and `evals/`.

**Logging.** `getLogger('app.<module>')` from `app/observability`; bind context with `bind`; never log a secret (scrubber is a backstop, not a licence). Errors that matter are `log.error({ err }, ...)`, not `console.log`.

**LLM features.** Call sites name a role; `app/ai/registry.ts` resolves the model. Provider SDK code lives only in a `ModelClient` implementation; tests use `FakeModelClient`. Prompts are versioned modules. Guidance in `docs/guides/llm-features.md`.

**Frontend (when used).** Nunjucks templates extend `base.njk`; shared primitives in `static/css/main.css`; page files kebab-case; BEM classes; no bundler. `app/web/CLAUDE.md`.

## Migration workflow

`app/models/` is canonical. `npm run mig.generate -- m="..."` diffs it against the last snapshot and writes the next SQL revision; review the diff. Revisions are forward-only: write the compensating revision rather than a downgrade. Index builds: `CREATE INDEX CONCURRENTLY` in a dedicated revision that starts with `-- migrate: no-transaction` and holds nothing else. Every revision must apply cleanly from an empty database and agree with the models (`npm run lint.migrations.roundtrip -- ROUNDTRIP_DATABASE_URL=<disposable>`); CI does this on every PR.

## Testing

TDD with integration tests as the primary signal: write the test that captures the behaviour, then implement. Unit tests (`tests/unit`) cannot open a database (the driver is mocked to throw). Integration tests (`tests/integration`) drive Fastify in-process via `app.inject()` and assert both HTTP responses and database state; they need `TEST_DATABASE_URL` + `TEST_ALLOW_DB=1`, and `TEST_REQUIRE_DB=1` makes a missing database a failure rather than a silent skip. Prefer factories over seed dumps; test behaviour (status codes, rows, payload shapes), not implementation. Query-count budgets live in `tests/integration/perf/budgets.ts`; a failing budget means fix the N+1 or bump the number in the same diff, visibly. Details: `docs/guides/testing.md`.

## Git workflow

- Branches: `feature/`, `fix/`, `bug/`, `refactor/`, `enhancement/`, `docs/` + short kebab-case description. No agent names, dates, or ticket ids in the branch name.
- Commits: one logical unit each; conventional-commit subject under 72 chars; explain *why* in the body when the diff does not. Stage only that unit's files and run the smallest relevant verification first.
- **Authorship is the local git identity. Never add Co-Authored-By or any AI attribution.**
- Never `--no-verify`, never force-push shared branches, never amend pushed commits.
- Open PRs with the `/pr` skill; the PR template asks for verification and docs.

## Agent workflow

Idea → `/create-product-pitch` (optional for mechanical work) → tech spec in `docs/plans/` → `/create-qa-checklist` → `/create-project` (tickets) → `/orchestrate` (parallel agents) → `/ship`. Per-repo overrides for ticket generation and browser verification: `docs/plans/ai-orchestrator-ticket-spec.md`. The `verdict-qa` agent (`.claude/agents/`) is the fresh-eyes gate before declaring UI work done. Full description: `docs/guides/agent-workflow.md`.

**Planning vs. executing.** If asked to plan, outline, or assess, do that and stop; do not start changing files until asked. If asked to build, build it completely and run the Definition of Done without asking.

## Infrastructure

The container image is the artifact; targets are Azure Container Apps (image) and Databricks Apps (source, same commit). `/health` reports `releaseSha`; `npm run deploy.freshness -- DEPLOY_URL=...` measures drift from `main`. Details and one-time setup: `deploy/README.md`. Secrets live in the platform's secret store, never in the repo or the image.

## Where the rules come from

Every guard traces to a named failure and ships with an escape hatch and a baseline: `docs/guides/programmatic-code-discipline.md`. Architectural principles: `docs/architecture/north-star.md`. Decisions: `docs/decisions/`.
