/**
 * LLM plumbing that contains no product logic.
 *
 * Role -> model routing, the client seam tests mock, and versioned prompt loading.
 * See app/ai/CLAUDE.md.
 */

export { type CallRecord, type Completion, FakeModelClient, type ModelClient } from './client.js';
export { type ModelChoice, resolve } from './registry.js';
