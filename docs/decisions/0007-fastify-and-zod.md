# 0007 — Fastify + Zod as the HTTP stack

**Status:** accepted · **Date:** 2026-09-07

## Context
The harness needs what FastAPI gave the Python sibling: a response schema declared on every route (so an untyped endpoint is a lint error), validation at the boundary, in-process request injection for tests, a plugin model for cross-cutting concerns, and structured logging out of the box. Express has none of these natively; Hono is excellent but younger and less conventional for server-side Node; NestJS brings a framework the layering guards would fight.

## Decision
Fastify 5 with `fastify-type-provider-zod`: Zod schemas in `app/schemas` are both the runtime contract (validation and serialisation) and the static types. Cross-cutting concerns are `fastify-plugin` plugins (`app/api/deps.ts`, `app/observability/middleware.ts`). Tests use `app.inject()`; no sockets. Server-rendered pages use `@fastify/view` with Nunjucks (a Jinja port, so the Python sibling's templates carry over).

## Consequences
Route conventions R1/R2 read `schema.response`. The request id is minted by `genReqId` so Fastify's own logger and the app's context agree. `pino` is the process logger (Fastify's native choice); `app/observability/logger.ts` wraps it so named loggers follow reconfiguration.
