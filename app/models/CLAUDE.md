# app/models — tables

- Drizzle `pgTable` definitions, one module per aggregate, re-exported from `index.ts`. Shared columns in `base.ts` (`timestamps`).
- This is the canonical schema. drizzle-kit reads every module here; after changing a table run `npm run mig.generate -- m="..."`, review the SQL, and follow CLAUDE.md "Migration workflow".
- Postgres enums via `pgEnum` with `UPPER_SNAKE_CASE` labels, mirrored by an `as const` object in `domain/`.
