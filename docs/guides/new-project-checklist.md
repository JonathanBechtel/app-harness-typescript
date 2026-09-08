# New project checklist

Do these in the first PR of a project created from the template. The `/update-docs` skill covers items 4–6.

1. **Rename.** `package.json` `name`; the image name in `tasks.ts` (`IMAGE` default), `ci.yml` (`tags:`), `deploy/databricks-apps/app.yaml` if needed; `<title>` in `app/templates/base.njk`; `CODEOWNERS` teams.
2. **Bootstrap.** `node scripts/bootstrap-env.ts`, then `npm run checks` and `npm run test`. Everything must be green before any feature work. Works on Windows (PowerShell), macOS, and Linux; needs Node 22 and Docker Desktop.
3. **Deploy target.** Follow `deploy/README.md`; set the GitHub environment variables for `stage` and `prod`; run **Build image** once and one stage deploy so `/health` shows a `releaseSha`. Set `DEPLOY_URL` to turn on the drift monitor. Delete the adapter you will not use, or leave it — it costs nothing.
4. **Describe the app.** Replace every `<!-- template:placeholder -->` section in `CLAUDE.md` and `docs/architecture/overview.md` with the truth. `npm run lint.docs` enforces this once real code exists.
5. **Decide and record.** Add ADRs for anything you change from the template defaults (database, web layer removal, LLM provider).
6. **Pick what you use.** API-only: leave `app/web` alone or remove `webRoutes` from `app/app.ts` and update `route-table.test.ts`. No LLM features: `app/ai` stays; it is inert. Both are the same stack either way.
7. **Team hygiene.** Enable branch protection requiring the `checks`, `tests`, and `image` jobs; require one review; set up Dependabot auto-merge policy if desired.
8. **First guard.** The first time a review catches something twice, run `/add-guard`.
