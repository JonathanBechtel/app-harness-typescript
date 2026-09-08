# app/ — the shipped package

This is the only code that ships in the image (`.dockerignore` excludes everything else; `npm run build` compiles it to `dist/app`). Layout is by responsibility, and dependency-cruiser (`.dependency-cruiser.cjs`) enforces the arrows:

```
api/ web/ cli/  ──►  services/  ──►  repositories/  ──►  models/
                        │
      schemas/ (edge contracts)   domain/ (pure)   ai/ (LLM plumbing)
      observability/ (ops plane, imports nothing)   utils/ (stateless)
```

| Package | Holds | Must not |
|---|---|---|
| `api/` | Route plugins, `deps.ts` (the `app.db` decorator). Thin: wire request → service → response. | Import repositories; control transactions explicitly. |
| `web/` | Optional Nunjucks page routes + `templating.ts`. Same rules as `api/`. | Import repositories. |
| `services/` | Business logic, sequencing, **transaction boundaries** (`withTransaction(db, ...)`). | Import `api`/`web`/`cli`. |
| `repositories/` | Row-level reads/writes taking a `DbHandle`. | Commit, rollback, orchestrate. |
| `models/` | Drizzle tables — the canonical schema drizzle-kit reads. `index.ts` re-exports every table module. | Import anything above it. |
| `schemas/` | Zod request/response contracts at the edge. | Be used as tables. |
| `domain/` | ORM-free value objects and pure rules. | Import persistence, services, or the edge. |
| `ai/` | Role→model registry, client seam, versioned prompts. | Hard-code a model id (see `tests/unit/model-centralization.test.ts`). |
| `cli/` | Runtime jobs run *inside the image* as `node dist/app/cli/<job>.js` (`migrate`, `healthcheck`). | Import or read from `scripts/`, `tests/`, `docs/`, `deploy/`, `evals/`. |
| `observability/` | Correlation context, pino root, scrubbing, request plugin. | Import any other app package (types excepted). |
| `utils/` | Stateless helpers (`<domain>-utils.ts`), DB client, runtime guards. | Hold business rules. |
| `migrations/` | SQL revisions + `meta/` journal written by drizzle-kit; applied by `cli/migrate.ts`. | Be edited by hand except to add the no-transaction marker. |
| `templates/`, `static/`, `data/` | Assets the package reads at runtime (copied into `dist/app` by the build). | Hold operator-only data (that goes in `scripts/data/`). |

Each code package has its own `CLAUDE.md` with the conventions that apply there. **When you add a package, add its `CLAUDE.md` and a row above** — `scripts/check-docs-freshness.ts` fails the build otherwise.
