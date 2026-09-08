/**
 * The client seam: one interface every LLM call goes through.
 *
 * Provider SDK calls belong in a concrete implementation of `ModelClient` in
 * this module family, never in a service. Tests substitute `FakeModelClient`;
 * nothing above this layer ever imports a vendor SDK, which is what keeps the
 * whole test suite runnable without credentials.
 *
 * The template ships no vendor implementation on purpose (no application logic).
 * When adding one, follow docs/guides/llm-features.md: pin the model id in
 * config, prefer adaptive thinking and streaming for long outputs, record usage
 * (input/output/cache tokens) on every call via `CallRecord`.
 */

/** Usage and identity of one model call, for cost attribution and evals. */
export interface CallRecord {
  readonly role: string;
  readonly provider: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly latencyMs: number;
}

/** The text a model returned plus the usage record behind it. */
export interface Completion {
  readonly text: string;
  readonly record: CallRecord;
}

export interface CompleteRequest {
  readonly role: string;
  readonly system: string;
  readonly prompt: string;
}

/** Minimal surface a provider adapter must implement. */
export interface ModelClient {
  /** Return the model's reply to `prompt` under `system` for `role`. */
  complete(request: CompleteRequest): Promise<Completion>;
}

export type Responder = (prompt: string) => string;

/** Deterministic stand-in for tests and evals: replies via `responder`. */
export class FakeModelClient implements ModelClient {
  readonly calls: CallRecord[] = [];

  constructor(private readonly responder: Responder = (prompt) => `echo: ${prompt}`) {}

  /** Produce a canned reply and record a zero-cost call. */
  async complete(request: CompleteRequest): Promise<Completion> {
    const text = this.responder(request.prompt);
    const record: CallRecord = {
      role: request.role,
      provider: 'fake',
      model: 'fake',
      inputTokens: request.prompt.length,
      outputTokens: text.length,
      cacheReadTokens: 0,
      latencyMs: 0,
    };
    this.calls.push(record);
    return Promise.resolve({ text, record });
  }
}
