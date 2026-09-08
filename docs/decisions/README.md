# Architecture Decision Records

One file per decision, numbered, written when the decision is made. Accepted records are immutable: to change course, write a new record that supersedes the old one and link both ways. Use `template.md`.

| # | Decision | Status |
|---|---|---|
| 0001 | Single source of agent instructions (CLAUDE.md; AGENTS.md/GEMINI.md are pointers) | accepted |
| 0002 | Postgres + postgres.js + Drizzle as the persistence stack; forward-only revisions | accepted |
| 0003 | The database reaches routes through the `app.db` decorator | accepted |
| 0004 | The container image is the deploy artifact; targets adapt to it | accepted |
| 0005 | `models/` are Drizzle tables, `schemas/` are Zod contracts | accepted |
| 0006 | One repo, one stack, every use case (optional web and AI layers stay present) | accepted |
| 0007 | Fastify + Zod as the HTTP stack | accepted |
| 0008 | TypeScript toolchain: tsc strict, ESLint + Prettier, dependency-cruiser, Vitest, tsx | accepted |
