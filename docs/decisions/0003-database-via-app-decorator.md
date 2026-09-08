# 0003 — The database reaches routes through the `app.db` decorator

**Status:** accepted · **Date:** 2026-09-07

## Context
The Python sibling sanctioned one dependency-injection spelling (`db: DbSession`) so the route-conventions guard could recognise it and reject sessions built inline. Fastify's idiom is decoration: a plugin attaches the client to the instance once and every route reads it from `app`. Mixed styles (some routes importing the module-level client, some building their own) defeat the guard and make tests that inject a database impossible.

## Decision
`app/api/deps.ts` decorates the instance with `db` (a `fastify-plugin`, so it is visible app-wide). Routes read `app.db` and pass it, or a transaction from `withTransaction`, to services. Route modules never import the module-level `db`/`sql` from `app/utils/db` and never call `postgres(...)`/`drizzle(...)` (route-conventions R3). `buildApp({ db })` lets tests supply their own client.

## Consequences
One spelling, greppable, type-checked through module augmentation. Other cross-cutting dependencies follow the same decorator shape.
