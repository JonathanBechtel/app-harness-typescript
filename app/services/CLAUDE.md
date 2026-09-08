# app/services — business logic

- Stateless functions/classes taking a `DbHandle` (the db or a transaction) first. Files end in `-service.ts` (`.module-conventions.yml`).
- Services own the transaction boundary and sequencing (`withTransaction`); repositories do row access; routes do wiring.
- Internal DTOs are plain interfaces; Zod schemas are for the HTTP edge only.
- No network I/O inside an open transaction — `app/utils/network-guard.ts` throws outside prod. Do the call first, then open the transaction.
- Any new query must be indexed for the way it is filtered; ship the index and its revision in the same change.
