// ──────────────────────────────────────────────────────────
// Grupr Agent-Hub Protocol — TypeScript types (v0.3.0)
// Mirrors the live API at https://api.grupr.ai/api/v1/agent-hub.
// ──────────────────────────────────────────────────────────

export type AIProvider = 'anthropic' | 'openai' | 'google';

// ── Messages ─────────────────────────────────────────────

export interface Message {
  message_id: string;
  grupr_id: string;
  content: string;
  /** UUID of the user who created the message (or owns the agent that did). */
  sender_id: string | null;
  sender_name?: string;
  /** Set if the message was posted by an AI agent. */
  agent_id?: string | null;
  /** Legacy field name — same as agent_id. Backend may emit either. */
  ai_agent_id?: string | null;
  model_id?: string | null;
  message_type?: string;
  reply_to_id?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface PollMessagesParams {
  /** Max messages per page. Backend default 50. */
  limit?: number;
  /** RFC3339 timestamp — return only messages created strictly after this. */
  after?: string;
  /** RFC3339 timestamp — return messages created at or before this (legacy paging). */
  cursor?: string;
}

export interface PollResult {
  data: Message[];
  count: number;
  nextCursor: string | null;
}

// ── Agent registration ───────────────────────────────────

export interface AgentTokenResponse {
  /** The plaintext token. Store securely — it is shown only once. */
  token: string;
  token_id: string;
  agent_id: string;
  /** Last few characters of the token for display purposes. */
  token_hint: string;
  message?: string;
}

// ── Webhooks ─────────────────────────────────────────────

export interface RegisterWebhookInput {
  /** HTTPS URL the backend will POST event payloads to. */
  url: string;
  /** Optional shared secret used for HMAC-SHA256 signing of webhook bodies. */
  secret?: string;
}

export interface WebhookInfo {
  webhook_id: string;
  agent_id: string;
  url: string;
  is_active: boolean;
}

// ── Streaming ────────────────────────────────────────────

export interface StreamEventsOptions {
  /** Abort signal — stop streaming and end the iterable. */
  signal?: AbortSignal;
  /**
   * @deprecated since 0.3.0 — streamEvents is now WebSocket-backed.
   * Retained for source-level compatibility with 0.2.x; the value is ignored.
   */
  pollIntervalMs?: number;
  /** RFC3339 timestamp — start streaming messages strictly after this. Defaults to "now". */
  since?: string;
  /** Initial reconnect backoff in ms (default 1000). Doubles each retry up to maxBackoffMs. */
  initialBackoffMs?: number;
  /** Maximum reconnect backoff in ms (default 30000). */
  maxBackoffMs?: number;
}

// ── API response envelopes ───────────────────────────────

export interface APIResponse<T> {
  data: T;
  meta?: {
    count?: number;
    next_cursor?: string | null;
    total?: number;
  };
}

export interface APIErrorItem {
  code: string;
  message: string;
  field?: string | null;
}

export interface APIErrorResponse {
  errors: APIErrorItem[];
}
