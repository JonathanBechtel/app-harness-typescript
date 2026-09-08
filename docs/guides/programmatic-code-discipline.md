# Programmatic code discipline

**Purpose:** encode past failures as automated enforcement so a build-in-a-hurry cannot repeat them. Lint is a floor, not a ceiling: it stops known failure modes from silently recurring under deadline pressure; it does not produce good design.

## The governing rule

> **Every rule traces to a specific past failure.** Rules without a failure behind them become noise, and noise trains people to bypass the whole system. When adding a rule, name the incident in the script's header comment.

**Every rule ships with:** the failure it descends from (header comment), an escape hatch requiring a written reason (`// discipline: <rule> <reason>`, `-- discipline:` in SQL; a bare marker is not a waiver), and a baseline or diff-scoping so it never blocks unrelated work.

**Every rule runs in three places** — `tasks.ts`, `lint-staged.config.js`, `.github/workflows/ci.yml` — with identical scope, so nothing passes locally and fails in CI or the reverse. Hooks are bypassable; CI is the enforcing copy. `tests/unit/guard-wiring.test.ts` asserts the three agree.

**Every rule has a test proving it fires.** A guardrail nobody has watched fail is an assumption (`tests/unit/check-*.test.ts`).

**Every rule refuses to pass on an empty scan.** "Checked nothing" must never print OK (`scripts/_check-runner.ts`).

**Every rule resolves aliases.** `import { delete as sqlDelete }` must not switch a guard off (`scripts/_ast.ts`).

## Three tiers

| Tier | Mechanism | Catches | Blind to |
|---|---|---|---|
| 1 | AST checkers (`scripts/check-*.ts`, TypeScript compiler API) | syntactic, local patterns | anything across call frames |
| 2 | Runtime guards (`app/utils/network-guard.ts`) | cross-frame, semantic violations at any depth | paths no test or traffic exercises |
| 3 | Structural contracts (dependency-cruiser, reflective tests, budgets) | layering drift, stale hand-maintained lists, cost creep | duplication that needs no import |

AST is not enough on its own: the worst transaction bug in the source material was an HTTP call four frames below the transaction. Tier 2 exists for that.

## Guard catalog

Whole-tree guards run on every push; diff-scoped ones compare against the PR base so existing code is never retrofitted wholesale.

| Guard | Scope | Failure it descends from |
|---|---|---|
| `eslint` + `prettier`, `tsc --noEmit` | whole tree | type drift, unreadable diffs |
| dependency-cruiser contracts (`.dependency-cruiser.cjs`) | whole tree | a "generic" framework secretly coupled to one source; routers querying tables directly |
| `check-complexity-ratchet.ts` + `complexity-baseline.json` | whole tree | per-file overrides hiding growth inside already-complex files |
| `check-file-size-ratchet.ts` | diff | 5,000-line services; 35,000-line merges beyond a reviewable unit |
| `check-route-conventions.ts` | path | untyped endpoints, implicit statuses on writes, clients built inline, pages outside the shared layout |
| `check-request-transaction-policy.ts` | path | commits scattered through services; partial writes on error |
| `check-unscoped-delete.ts` | path | a rebuild that wiped tables every run, destroying history (north-star P2) |
| `check-empty-method-stubs.ts` | path | overrides that silently swallowed behaviour |
| `check-migration-safety.ts` | diff | a non-concurrent index build that stalled a deploy and 500'd public routes for 96 minutes |
| `check-migration-drift.ts` | CI round-trip | a model change shipped without its revision; passed every test, failed on the first production query |
| `check-duplicate-code.ts` | diff (3% of changed lines) | decompositions that copied helpers into both halves; AI-assisted duplication |
| `check-test-titles.ts` | diff (line) | undocumented tests nobody could interpret when they failed |
| `check-test-float-comparisons.ts` | diff (line) | flaky float equality in golden-number tests |
| `check-runtime-entrypoints.ts` | whole tree | a shipped module that read from `scripts/` and broke only in the container |
| `check-module-conventions.ts` + `.module-conventions.yml` | path | placement/naming drift in directories that had been standardised |
| `check-docs-freshness.ts` | whole tree | a project whose CLAUDE.md still described the template six months in |
| `check-patch-coverage.ts` | CI gate | fixes merged with their new branch never executed by a test |
| `check-deploy-freshness.ts` (scheduled) | observation | production ran a 3.5-day-old image through an incident whose fix was merged |
| `network-guard.ts` (runtime) | any depth | HTTP calls inside open transactions holding locks across round-trips |
| `settings-documented.test.ts`, `model-centralization.test.ts`, `route-table.test.ts`, `guard-wiring.test.ts` | reflective | undocumented settings, unscrubbed secrets, model ids in six places, routes silently disappearing, a guard wired in two places out of three |
| `tests/integration/perf/budgets.ts` | budget | a 25-query serial waterfall of sub-3ms queries |

Not ported from the Python sibling: `check_migration_enum_case.py` (SQLAlchemy persisted enum member *names*; Drizzle persists values, so the failure cannot occur) and `check_migration_teardown_residue.py` (there is no downgrade to leave residue; the drift check covers the schema-vs-code failure).

## What should NOT be a lint rule

- Freshness semantics — encode in a value type, not a regex.
- "Is this the right abstraction?" — judgment; that is what review questions in `docs/architecture/north-star.md` are for.
- File cohesion — line count is a proxy; a 400-line file doing three things is worse than a 700-line cohesive one. The ratchet buys pressure, not wisdom.
- Architectural intent — no checker notices a framework has one instance.

## Adding a rule

See `docs/guides/adding-a-guard.md` and the `/add-guard` skill. Two rules that are respected beat eight that get waived.
