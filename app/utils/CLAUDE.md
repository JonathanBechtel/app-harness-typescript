# app/utils — stateless helpers and infrastructure

`db.ts` (client, `withTransaction`, readiness probe) and `network-guard.ts` (no network I/O in a transaction) are infrastructure. Everything else is a pure helper named `<domain>-utils.ts`, placed near its consumers if it only has one.
