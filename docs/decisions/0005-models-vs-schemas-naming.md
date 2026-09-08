# 0005 — `models/` are Drizzle tables, `schemas/` are Zod contracts

**Status:** accepted · **Date:** 2026-09-07

## Context
The predecessors used the two words in opposite senses. Either convention works; having both in one organisation does not. The Python sibling settled on models = ORM tables, schemas = edge contracts.

## Decision
`app/models/` = Drizzle `pgTable` definitions (the schema drizzle-kit reads). `app/schemas/` = Zod request/response schemas. Repositories return rows; services map to edge shapes.

## Consequences
Matches the Python sibling and the common ecosystem usage. drizzle-kit and the test fixtures read `app/models/index.ts`.
