# app/ai — LLM plumbing (no product logic)

- Call sites name a **role**; `resolve(role)` returns the (provider, model). Model ids live only in `app/config.ts` and per-role env vars. A model id anywhere else under `app/` fails `tests/unit/model-centralization.test.ts`.
- Every provider call goes through a `ModelClient` implementation (`client.ts`); tests use `FakeModelClient`. Vendor SDK imports are confined to client implementations.
- Record a `CallRecord` (tokens, latency) for every call; that is what evals, cost tracking, and incident triage read.
- Prompts are versioned modules under `prompts/<family>/vN.ts` exporting `VERSION`, `TEMPLATE`, `render()`; bump the version when the contract changes.
- Provider guidance (model choice, thinking, streaming, caching): `docs/guides/llm-features.md`.
