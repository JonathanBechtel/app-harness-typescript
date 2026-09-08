# 0002 — Postgres + postgres.js + Drizzle; forward-only revisions

**Status:** accepted · **Date:** 2026-09-07

## Context
The Python sibling of this template (app-harness-python) settled on Postgres because the harness pieces worth keeping (concurrent index migrations, schema-per-run test isolation, lock timeouts) are Postgres-shaped, and both deploy targets offer managed Postgres. In the TypeScript ecosystem the tried-and-true schema-as-code ORM is Drizzle: the schema lives in `app/models`, types are inferred from it, and drizzle-kit diffs it to produce SQL revisions. Drizzle's revisions are forward-only (no downgrade), and its bundled migrator runs every pending revision in one transaction, which is exactly the lock-lifetime hazard the migration guards exist to prevent.

## Decision
Postgres via `postgres.js`, Drizzle tables in `app/models` as the canonical schema, drizzle-kit `generate` for revisions, and a small runner in `app/cli/migrate.ts` that applies each revision in its own transaction with a `lock_timeout`, and runs revisions marked `-- migrate: no-transaction` (concurrent index builds) statement by statement. Revisions are forward-only: rollback is a compensating revision. CI proves every PR's revisions apply from an empty database, are idempotent, and agree with the models (`scripts/check-migration-drift.ts`).

## Consequences
The migration-safety guard checks SQL text (M1–M3), the runner (M4) and the journal (M5) instead of Python AST. The Python harness's downgrade round-trip and enum-teardown check have no equivalent because there is no downgrade; the drift check covers the same failure (a database that does not match the code). SQLAlchemy's enum name/value split does not exist in Drizzle, so the enum-case guard was not ported (`docs/guides/programmatic-code-discipline.md`).
