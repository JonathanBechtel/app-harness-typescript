# app/cli — runtime jobs

- Entry point shape: `export async function main(): Promise<number>` + `if (isMain(import.meta)) await runJob('name', main)` from `_runner.ts`. Exit code is the outcome.
- Invoked as `node dist/app/cli/<module>.js` from a scheduler (or `npx tsx app/cli/<module>.ts` in development); never reference `scripts/`.
- `migrate.ts` applies revisions at container start; `healthcheck.ts` is the smallest working example.
- Shared logic lives in `services/`, imported by both jobs and routes.
- Anything a human runs from a checkout (backfills, audits, one-off fixes) is a `scripts/` script, not a job.
