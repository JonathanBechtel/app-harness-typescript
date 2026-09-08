# Module conventions

Vocabulary (from `app/CLAUDE.md`): **models** are Drizzle tables; **schemas** are Zod edge contracts; **repositories** do row access and never control transactions; **services** own logic and transactions; **helpers/utils** are stateless and named `<domain>-utils.ts`.

Enforcement is opt-in per directory via `.module-conventions.yml` and `scripts/check-module-conventions.ts`:

1. Refactor a directory until it is internally coherent.
2. Enroll it: `path` + the rule families that apply (`services`, `repositories`, `helpers`, `models`, `transformers`).
3. From then on, misplaced or misnamed modules there fail the build with a relocation hint.
4. Repeat directory by directory. Do not try to normalise the whole tree at once.

Rules: files under a family directory carry the family suffix (MODC001); a suffixed file at the root belongs under its family directory (MODC002); a root file whose shape looks like a family (a `pgTable`/`z.object` export, repository or model imports or a `DbHandle` parameter, only functions) is flagged with a hint (MODC003); an enrolled family directory must exist (MODC004). `index.ts`, `_private.ts` and test modules are exempt from suffix rules.

Why this matters more with AI: when discovery or convention is by filename, filename rules must be mechanical or they rot within weeks.
