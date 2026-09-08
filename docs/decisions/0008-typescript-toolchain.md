# 0008 — TypeScript toolchain

**Status:** accepted · **Date:** 2026-09-07

## Context
The Python sibling's toolchain is ruff + mypy + import-linter + pytest + pre-commit. Each has a TypeScript analogue, but the guards need specifics: machine-readable complexity findings per file (for the ratchet), max-params and max-statements rules, JSDoc format checking, import-layer contracts as configuration, a duplicate-code reporter with line ranges, and an AST the guard scripts can walk without extra dependencies.

## Decision
- `tsc --noEmit` in strict mode over `app/`, `scripts/`, `tests/`, `evals/` (stricter than the Python sibling, which type-checked `app/` only). TypeScript is pinned to 5.x: the guard scripts use the compiler API, which the native (7.x) compiler does not expose the same way.
- ESLint 10 (flat config, typescript-eslint type-checked, eslint-plugin-jsdoc) + Prettier. Biome was considered and rejected: it lacks max-params, max-statements and JSDoc rules the guards depend on.
- dependency-cruiser for the six import contracts.
- jscpd for the diff-scoped duplicate-code gate.
- Vitest (unit and integration projects) with v8 coverage; `@playwright/test` for the browser tier; `scripts/check-patch-coverage.ts` replaces diff-cover.
- tsx to run TypeScript directly in development and for the guard scripts; `tsc` builds `dist/` for the image. Node's built-in type stripping runs only `scripts/bootstrap-env.ts`, which must work before `node_modules` exists.
- husky + lint-staged for the hooks (the pre-commit framework is Python). `tasks.ts` is the single task definition; `package.json` scripts are generated from it and a test keeps them in step.

## Consequences
One config per tool, each mirrored by lint-staged and CI, with `tests/unit/guard-wiring.test.ts` asserting they agree. npm is the package manager (no corepack step on Windows); `package-lock.json` is committed.
