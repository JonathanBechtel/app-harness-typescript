# Deployment

**The container image is the deploy artifact.** `Dockerfile` at the repo root builds it; `.github/workflows/build-image.yml` publishes it tagged `sha-<commit>` to GHCR and, when configured, Azure Container Registry. Every target below runs the same commit.

| Target | Mechanism | Adapter |
|---|---|---|
| Local | `npm run docker.up` (compose: Postgres + image) | `docker-compose.yml` |
| Azure Container Apps | Pull the image by sha tag; `az containerapp update --image` | [`azure-container-apps/`](azure-container-apps/README.md) |
| Databricks Apps | Source deploy (the platform installs `package.json` dependencies and runs `app.yaml`'s command); same commit, `dist/` compiled at deploy time | [`databricks-apps/`](databricks-apps/README.md) |

## The contract every target honours

- **Port**: the process listens on `$PORT` (default 8000). Databricks substitutes `DATABRICKS_APP_PORT` into the command.
- **Config**: environment variables only (`app/config.ts`). Secrets come from the platform's secret store, never from files in the image.
- **Migrations**: `node dist/app/cli/migrate.js` runs before the server starts (the image `CMD` does this). Revisions are lock-safe by construction (`scripts/check-migration-safety.ts`).
- **Health**: `/health` (liveness, no DB) and `/health/db` (readiness). Point platform probes at them.
- **Identity**: `/health` reports `releaseSha`, so `npm run deploy.freshness -- DEPLOY_URL=...` and `.github/workflows/deploy-freshness.yml` can measure drift from `main`.
- **Concurrency**: one Node process per container; scale replicas, not workers. `DB_POOL_SIZE` is per replica.
- **Logs**: JSON to stdout outside dev; correlated by `request_id` / `run_id`.
- **Scheduled work**: `node dist/app/cli/<job>.js` in the same image (Azure Container Apps Jobs, or a Databricks job).

Infrastructure definitions (Bicep/Terraform) live in the platform team's infra repository, not here; this repo may stage them under `deploy/<target>/infra/` for review but never applies them.
