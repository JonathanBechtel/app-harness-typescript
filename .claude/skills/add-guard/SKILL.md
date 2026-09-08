---
name: add-guard
description: Turn a bug, review finding, or convention into a permanent mechanical guard (AST checker, dependency-cruiser contract, reflective test, or runtime guard) wired into tasks.ts, lint-staged, and CI with a test proving it fires. Use right after fixing a regression or when a rule keeps being broken by hand.
allowed-tools: Bash, Read, Write, Edit, Grep, Glob
---

# Add a guard

Read `docs/guides/adding-a-guard.md` first. Then:

1. **Name the failure.** Write the incident (what happened, why review missed it) — it becomes the script's header comment. No failure, no rule.
2. **Pick the tier** (`docs/guides/programmatic-code-discipline.md`): AST checker for syntactic/local patterns; dependency-cruiser rule for layering; reflective unit test for hand-maintained lists; runtime guard for cross-frame behaviour.
3. **Write it** in `scripts/check-<rule>.ts` using `_check-runner.ts` (path-taking → `runCli`; whole-tree → own argv + `report`; line-scoped → `diffScopedCli`). Resolve aliases with `_ast.ts`. Support `// discipline: <rule> <reason>` via `_discipline.ts` unless there is a reason not to. Refuse to pass on an empty scan.
4. **Prove it fires.** `tests/unit/check-<rule>.test.ts`: seed the original violation into a scratch file and assert the checker reports it; assert a compliant sample passes; assert the repo is currently clean.
5. **Wire all three**: `tasks.ts` task, `lint-staged.config.js` entry (mirroring CI's scope exactly), `.github/workflows/ci.yml` step. `tests/unit/guard-wiring.test.ts` asserts they agree.
6. **Catalog it** in `docs/guides/programmatic-code-discipline.md` (the docs-freshness check fails otherwise).
