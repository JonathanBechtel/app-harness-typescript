# app-harness-typescript

A starting point for internal applications: a Fastify service skeleton with the engineering guardrails already wired in. **It contains no product logic.** It contains everything that lets a new project start safely on day one and stay that way:

- **Guardrails that run in three places** (git hooks, `npm run`, CI) and cannot drift apart: lint, types, import-layer contracts, complexity and file-size ratchets, migration lock-safety, duplicate-code gate, route conventions, transaction policy, delete-scope ban, test hygiene, and a docs-freshness check.
- **A test harness** with a real-Postgres integration tier (per-run schema isolation, explicit opt-in, no silent skips), unit tests that physically cannot touch a database, query-count budgets, browser smoke tests, and meta-tests proving every guard fires.
- **One deploy artifact** (the container image) with adapters for Azure Container Apps and Databricks Apps, health probes, release identity, and a drift monitor.
- **Agent documentation** that tells any AI what this repo is and how to work in it, plus mechanical pressure to keep those docs describing the real app as it grows.
- **LLM plumbing** without product logic: role→model routing, a mockable client seam, versioned prompts, and an eval harness.
- **Self-updating.** Projects created from the template receive harness changes as a weekly pull request (`.github/workflows/template-sync.yml`); their own CI gate decides whether it lands. See `docs/guides/receiving-harness-updates.md`.

This is the TypeScript sibling of [`app-harness-python`](https://github.com/JonathanBechtel/app-harness-python) (FastAPI). The two keep functional and structural parity: the same guards, the same layout, the same deploy contract, each in its own ecosystem's idioms.

## Start a project

```bash
# 1. Create a repo from this template, clone it, then (any OS, Node >= 22.18):
node scripts/bootstrap-env.ts     # deps, local Postgres on :5439, .env, migrations, hooks, smoke test
npm run dev                       # http://localhost:8000/health
# 2. Follow docs/guides/new-project-checklist.md (rename, describe the app, pick deploy targets).
```

Everything an engineer or agent needs is in [`CLAUDE.md`](CLAUDE.md). `npm run help` lists every task.

**Windows, macOS, Linux.** Requirements are Node 22 and Docker Desktop. Every task is defined once in `tasks.ts` and runs without a shell; the `package.json` scripts are a thin shim over it. Native Windows (PowerShell) works as-is; WSL2 also works. Line endings are normalised to LF by `.gitattributes`.

## Layout

```
app/            shipped package (api, web, services, repositories, models, schemas, domain, ai, cli, observability, utils)
scripts/        operator tooling and the guard scripts (never shipped)
tests/          unit / integration / e2e (+ perf budgets, guard meta-tests)
evals/          LLM quality benchmarks (on demand)
docs/           architecture, guides, decisions (ADRs), plans, runbooks
deploy/         target adapters: Azure Container Apps, Databricks Apps
.github/        CI, image build, deploys, drift monitor
.claude/        agent settings, Stop hook (guard gate), skills, review agent
```

## Why so many guards?

Every rule here descends from a real failure in a predecessor codebase, is enforced mechanically rather than by review, ships with an escape hatch that requires a written reason, and is baselined so it never blocks unrelated work. The reasoning is in [`docs/guides/programmatic-code-discipline.md`](docs/guides/programmatic-code-discipline.md).
