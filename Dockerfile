# The deployable artifact. One image for every target (Azure Container Apps,
# local docker compose, anything that runs OCI images). Databricks Apps deploys
# from source instead — see deploy/databricks-apps/ — but runs the same code.
#
# Build: npm run docker.build      (passes --build-arg GIT_SHA=$(git rev-parse HEAD))

FROM node:22-bookworm-slim AS builder
ENV NODE_ENV=development
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
# .dockerignore keeps this to app/, tsconfig*.json, tasks.ts and packaging metadata.
COPY . .
RUN npx tsx tasks.ts build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production
# Non-root: Azure Container Apps and most platforms allow it; nothing here needs root.
RUN useradd --create-home --uid 10001 appuser
WORKDIR /app
COPY --from=builder --chown=appuser:appuser /build/node_modules ./node_modules
COPY --from=builder --chown=appuser:appuser /build/dist ./dist
COPY --chown=appuser:appuser package.json ./
USER appuser

# Release identity for /health and error reporting. Passed by the build workflow
# as the deploying commit; absent in a local build, where /health reports null.
# Declared after the COPY so changing it does not invalidate the layers above.
ARG GIT_SHA=""
ENV RELEASE_SHA=$GIT_SHA

EXPOSE 8000
# Migrations run before the server binds. PORT is honoured for platforms that
# inject one (Azure Container Apps, Databricks Apps via DATABRICKS_APP_PORT).
CMD ["sh", "-c", "node dist/app/cli/migrate.js && node dist/app/main.js"]
