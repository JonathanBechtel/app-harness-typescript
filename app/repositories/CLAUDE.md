# app/repositories — row access

- Functions take a `DbHandle` and return rows or plain values. No transaction control, no cross-repository orchestration.
- Files end in `-repository.ts`. Routers never import this package (dependency-cruiser contract 3): scoped/authorized access is a service concern.
- `db.delete(table)` must always carry a `.where(...)`; retain history by default (`scripts/check-unscoped-delete.ts`).
