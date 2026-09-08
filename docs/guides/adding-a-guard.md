# Adding a guard

Use when a bug, review finding, or convention keeps being broken by hand and the class of failure is mechanisable.

1. **Write the failure down.** One paragraph: what happened, why review missed it, what would have caught it. This becomes the script's header comment. If you cannot name a failure, do not add the rule.
2. **Choose the tier.** Syntactic/local → AST checker (TypeScript compiler API via `scripts/_ast.ts`). Cross-frame/semantic → runtime guard (dev/test throw, prod warn). Layering → dependency-cruiser rule in `.dependency-cruiser.cjs`. A hand-maintained list mirroring a structure the code knows → reflective unit test (the code supplies the universe, the test asserts the list covers it, stale entries fail too).
3. **Implement** in `scripts/check-<rule>.ts`:
   - path-taking → `runCli(argv, { checkAll, checkPaths, ... })`; `checkAll()` must throw if the scope matches nothing;
   - whole-tree → own argv, `report(...)`, refuse empty scans;
   - line-scoped → `diffScopedCli(...)` so untouched lines never fail.
   - Resolve names via `_ast.moduleAliases/resolve`; support `// discipline: <rule> <reason>` via `_discipline`; scope string scans to real sinks so prose that *discusses* the hazard passes (comments are not AST nodes).
4. **Prove it fires.** `tests/unit/check-<rule>.test.ts`: a seeded violation is reported; compliant code passes; the waiver works only with a reason; a "repo is clean" test asserts the tree passes today. Watch the test fail before the guard exists.
5. **Wire all three** with identical scope: `tasks.ts` task (+ add to `checks` if whole-tree), `lint-staged.config.js` entry, `ci.yml` step (or rely on `npm run checks`). `tests/unit/guard-wiring.test.ts` checks presence.
6. **Catalog it** in `programmatic-code-discipline.md` (docs-freshness D3 fails otherwise) and mention the convention in the relevant package `CLAUDE.md`.
7. **Baseline, don't block.** If the tree has existing violations, ship a shrink-only allowlist or diff-scope the rule. A stale allowlist entry must fail, or the baseline silently claims more debt than exists.
