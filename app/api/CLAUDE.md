# app/api — HTTP edge

- One module per resource under `routes/`; each exports a `FastifyPluginAsyncZod` named `<resource>Routes`; register it in `app/app.ts`.
- Routes are thin: parse → call a service → shape the response. No queries, no business rules.
- The database is `app.db` (decorated by `deps.ts`). Route modules never import the module-level `db`/`sql` from `app/utils/db` and never build a client inline; they pass `app.db` (or a transaction) to services.
- Every route declares `schema.response` (a Zod shape; `HtmlPage` for pages). Write methods declare explicit numeric status codes in it (201 create, 204 delete; no `default`/`2xx`). Throw Fastify errors (`@fastify/sensible` or `reply.code(...)`) for error cases; list endpoints order deterministically and paginate.
- Transactions belong to the route or service via `withTransaction(app.db, async (tx) => ...)`; never `commit()`/`rollback()`/`startTransaction()` in request code.

Enforced by `scripts/check-route-conventions.ts` (R1–R3) and `scripts/check-request-transaction-policy.ts`.
