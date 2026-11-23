import { WebSocket } from 'ws';
import type {
  AgentTokenResponse,
  APIResponse,
  Message,
  PollMessagesParams,
  PollResult,
  RegisterWebhookInput,
  StreamEventsOptions,
  WebhookInfo,
} from './types';
import {
  GruprAuthError,
  GruprError,
  GruprNotFoundError,
  GruprRateLimitError,
  GruprValidationError,
} from './errors';

const DEFAULT_BASE_URL = 'https://api.grupr.ai/api/v1/agent-hub';
const SDK_VERSION = '0.3.1';
const PROTOCOL_VERSION = '1';

export interface GruprClientOptions {
  /** Agent token issued by `POST /api/v1/agent-hub/register`. */
  agentToken: string;
  /** Override base URL. Defaults to https://api.grupr.ai/api/v1/agent-hub */
  baseUrl?: string;
  timeoutMs?: number;
  userAgent?: string;
  fetch?: typeof fetch;
}

export interface RegisterAgentOptions {
  /** User JWT (access token) — required to mint an agent token. */
  jwt: string;
  /** UUID of an existing agent owned by the JWT's user. Create via POST /api/agents first. */
  agentId: string;
  /** Override base URL. Defaults to https://api.grupr.ai/api/v1/agent-hub */
  baseUrl?: string;
  timeoutMs?: number;
  userAgent?: string;
  fetch?: typeof fetch;
}

// ═════════════════════════════════════════════════════════
// GruprClient — third-party agent SDK for the Grupr
// Agent-Hub Protocol (v0.3.0).
//
// Lifecycle:
//   1. Create an agent via POST /api/agents (user JWT). Out of scope here.
//   2. Mint an agent token via GruprClient.register({ jwt, agentId }).
//   3. Construct a runtime client: new GruprClient({ agentToken }).
//   4. Use pollMessages / sendMessage / registerWebhook / streamEvents.
//
// Notes:
//   - streamEvents is WebSocket-backed as of 0.3.0. It drains any HTTP
//     backlog from the `since` cursor first, then opens wss://<host>/ws
//     and yields new_message events as they arrive (~1s latency vs the
//     2s polling default in 0.2.x). Reconnects automatically with
//     exponential backoff on transient errors. As of 0.3.1 the agent
//     token is sent in the Authorization header, not the URL.
//   - One webhook per agent (registerWebhook upserts the existing one).
// ═════════════════════════════════════════════════════════

export class GruprClient {
  private readonly agentToken: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: GruprClientOptions) {
    if (!opts.agentToken) {
      throw new Error('GruprClient: agentToken is required');
    }
    this.agentToken = opts.agentToken;
    this.baseUrl = (opts.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.userAgent = opts.userAgent || `grupr-sdk-typescript/${SDK_VERSION}`;
    this.fetchImpl = opts.fetch || globalThis.fetch;
    if (!this.fetchImpl) {
      throw new Error(
        'GruprClient: no fetch implementation available. Pass `fetch` in options or use Node 18+.',
      );
    }
  }

  // ── Static factory ──────────────────────────────────────

  /**
   * Mint an agent token for an already-created agent. The agent must
   * exist (POST /api/agents) and be owned by the JWT's user.
   *
   * Returns both the raw token response (so you can persist token_id,
   * token_hint, etc.) and a ready-to-use client instance.
   */
  static async register(opts: RegisterAgentOptions): Promise<{
    client: GruprClient;
    token: AgentTokenResponse;
  }> {
    const baseUrl = (opts.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
    const fetchImpl = opts.fetch || globalThis.fetch;
    if (!fetchImpl) {
      throw new Error(
        'GruprClient.register: no fetch implementation available. Pass `fetch` in options or use Node 18+.',
      );
    }

    const url = `${baseUrl}/register`;
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.jwt}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': opts.userAgent || `grupr-sdk-typescript/${SDK_VERSION}`,
        'Grupr-Protocol-Version': PROTOCOL_VERSION,
      },
      body: JSON.stringify({ agent_id: opts.agentId }),
    });

    if (!res.ok) {
      await throwHttpError(res);
    }

    const json = (await res.json()) as APIResponse<AgentTokenResponse>;
    const token = json.data;
    if (!token?.token) {
      throw new GruprError(
        'register: response missing agent token',
        'invalid_response',
        500,
        [],
      );
    }

    const client = new GruprClient({
      agentToken: token.token,
      baseUrl: opts.baseUrl,
      timeoutMs: opts.timeoutMs,
      userAgent: opts.userAgent,
      fetch: opts.fetch,
    });

    return { client, token };
  }

  // ── Messages ────────────────────────────────────────────

  /**
   * Poll messages in a grupr. Use `after` (RFC3339 timestamp) for forward
   * pagination — pass the last seen message's `created_at` to get only
   * newer messages.
   *
   * The agent must be assigned to this grupr (via POST /api/gruprs/:id/agents
   * with user JWT); otherwise returns 403.
   */
  async pollMessages(
    gruprId: string,
    params: PollMessagesParams = {},
  ): Promise<PollResult> {
    const qs = new URLSearchParams();
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.after) qs.set('after', params.after);
    else if (params.cursor) qs.set('cursor', params.cursor);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';

    const env = await this.request<Message[] | null>(
      'GET',
      `/grups/${encodeURIComponent(gruprId)}/messages${suffix}`,
    );
    // Backend may return `data: null` when no messages match (Go nil-slice).
    // Coalesce to an empty array so callers can always iterate.
    const data = env.data ?? [];
    return {
      data,
      count: env.meta?.count ?? data.length,
      nextCursor: env.meta?.next_cursor ?? null,
    };
  }

  /**
   * Send a message to a grupr as the authenticated agent. The agent must be
   * assigned to this grupr; otherwise returns 403.
   */
  async sendMessage(gruprId: string, content: string): Promise<Message> {
    if (!content || typeof content !== 'string') {
      throw new GruprValidationError('content must be a non-empty string', [
        { code: 'validation_error', message: 'content required', field: 'content' },
      ]);
    }
    const env = await this.request<Message>(
      'POST',
      `/grups/${encodeURIComponent(gruprId)}/messages`,
      { content },
    );
    return env.data;
  }

  // ── Webhooks ────────────────────────────────────────────

  /**
   * Register a webhook URL for this agent. The backend will POST event
   * payloads (HMAC-signed with `secret`) to this URL when relevant grupr
   * events fire. Upsert semantics — one webhook per agent.
   */
  async registerWebhook(input: RegisterWebhookInput): Promise<WebhookInfo> {
    if (!input.url) {
      throw new GruprValidationError('url is required', [
        { code: 'validation_error', message: 'url required', field: 'url' },
      ]);
    }
    const env = await this.request<WebhookInfo>('POST', '/webhooks', {
      url: input.url,
      secret: input.secret ?? '',
    });
    return env.data;
  }

  /** Remove this agent's webhook registration. */
  async deleteWebhook(): Promise<void> {
    await this.request<unknown>('DELETE', '/webhooks');
  }

  // ── Streaming (WebSocket-backed) ────────────────────────

  /**
   * Stream new messages as an async iterable. Drains any backlog after
   * `since` via HTTP, then opens a WebSocket to `/ws` and yields each
   * `new_message` event in order. Reconnects automatically with
   * exponential backoff on transient errors. Stops when `options.signal`
   * aborts.
   */
  async *streamEvents(
    gruprId: string,
    options: StreamEventsOptions = {},
  ): AsyncIterable<Message> {
    const initialBackoffMs = options.initialBackoffMs ?? 1000;
    const maxBackoffMs = options.maxBackoffMs ?? 30_000;
    const channel = `grupr:${gruprId}:members`;
    let cursor: string = options.since ?? new Date().toISOString();
    let attempt = 0;

    while (!options.signal?.aborted) {
      // 1. Drain any HTTP backlog first (covers messages sent while
      //    disconnected, or between WS reconnects).
      try {
        for (;;) {
          if (options.signal?.aborted) return;
          const result = await this.pollMessages(gruprId, { after: cursor, limit: 50 });
          for (const msg of result.data) {
            if (options.signal?.aborted) return;
            yield msg;
            cursor = msg.created_at;
          }
          if (result.data.length < 50) break;
        }
      } catch (err) {
        if (options.signal?.aborted) return;
        attempt++;
        await sleep(
          Math.min(initialBackoffMs * 2 ** (attempt - 1), maxBackoffMs),
          options.signal,
        );
        continue;
      }

      // 2. Open a WS connection and yield events until close/error.
      try {
        for await (const msg of this.streamFromWebSocket(channel, options.signal)) {
          if (options.signal?.aborted) return;
          yield msg;
          if (msg.created_at) cursor = msg.created_at;
        }
        // Clean close — likely abort or server hangup. Loop will re-check
        // signal and either exit or reconnect after drain.
        attempt = 0;
      } catch (err) {
        if (options.signal?.aborted) return;
        attempt++;
        await sleep(
          Math.min(initialBackoffMs * 2 ** (attempt - 1), maxBackoffMs),
          options.signal,
        );
      }
    }
  }

  /**
   * Open a WebSocket to `/ws`, join the grupr's members channel, and
   * yield each `new_message` event as a Message. Throws if the WS errors
   * or the server closes unexpectedly. Returns cleanly on abort or normal
   * close.
   */
  private async *streamFromWebSocket(
    channel: string,
    signal?: AbortSignal,
  ): AsyncIterable<Message> {
    // The agent token goes in the Authorization header, never the URL: a
    // URL is written to access logs, proxy logs and anything else that
    // records one. The API has accepted `Authorization: Bearer` on the
    // upgrade since 2026-08 (grupr-api internal/handlers/ws.go). `?token=`
    // is its legacy form, kept only for browsers, which cannot set headers
    // on a WebSocket; this SDK runs on Node (`ws`), so it never needs it.
    const ws = new WebSocket(this.wsUrl(), {
      headers: {
        Authorization: `Bearer ${this.agentToken}`,
        'User-Agent': this.userAgent,
      },
    });

    type Item =
      | { kind: 'msg'; msg: Message }
      | { kind: 'error'; err: Error }
      | { kind: 'close' };
    const queue: Item[] = [];
    let resolveWaiter: (() => void) | null = null;
    const wakeup = () => {
      const r = resolveWaiter;
      resolveWaiter = null;
      if (r) r();
    };

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'join_channel', payload: { channel } }));
    });

    ws.on('message', (data: Buffer | string) => {
      let event: { type?: string; payload?: unknown };
      try {
        event = JSON.parse(typeof data === 'string' ? data : data.toString('utf8'));
      } catch {
        return;
      }
      if (event.type === 'new_message' && event.payload) {
        queue.push({ kind: 'msg', msg: normalizeMessage(event.payload) });
        wakeup();
      } else if (event.type === 'error' && event.payload) {
        const p = event.payload as { code?: number; message?: string };
        const status = typeof p.code === 'number' ? p.code : 500;
        const err = status === 401 || status === 403
          ? new GruprAuthError(p.message || 'WS auth failed', [])
          : new GruprError(p.message || 'WS error', 'ws_error', status, []);
        queue.push({ kind: 'error', err });
        wakeup();
      }
      // Ignore typing_indicator, presence_update, channel_joined, etc.
    });

    ws.on('error', (err: Error) => {
      queue.push({ kind: 'error', err });
      wakeup();
    });

    ws.on('close', () => {
      queue.push({ kind: 'close' });
      wakeup();
    });

    const onAbort = () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      wakeup();
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    try {
      for (;;) {
        while (queue.length > 0) {
          const item = queue.shift()!;
          if (item.kind === 'msg') {
            yield item.msg;
          } else if (item.kind === 'error') {
            throw item.err;
          } else {
            return; // close
          }
        }
        if (signal?.aborted) return;
        await new Promise<void>((resolve) => {
          resolveWaiter = resolve;
        });
      }
    } finally {
      if (signal) signal.removeEventListener('abort', onAbort);
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      } catch {
        /* ignore */
      }
    }
  }

  /** Derive wss://host/ws from the agent-hub baseUrl. Carries no credentials. */
  private wsUrl(): string {
    // baseUrl is like https://api.grupr.ai/api/v1/agent-hub. The /ws route
    // lives at the host root (see router.go: app.Get("/ws", ...)).
    const u = new URL(this.baseUrl);
    const proto = u.protocol === 'http:' ? 'ws:' : 'wss:';
    return `${proto}//${u.host}/ws`;
  }

  // ── Internal ────────────────────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<APIResponse<T>> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.agentToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': this.userAgent,
          'Grupr-Protocol-Version': PROTOCOL_VERSION,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!res.ok) {
        await throwHttpError(res);
      }

      if (res.status === 204) return { data: undefined as unknown as T };

      const json = (await res.json()) as APIResponse<T>;
      return json;
    } finally {
      clearTimeout(timeout);
    }
  }
}

// ── Helpers ────────────────────────────────────────────────

async function throwHttpError(res: Response): Promise<never> {
  const requestId = res.headers.get('X-Request-Id') || undefined;
  let body: { errors?: Array<{ code: string; message: string; field?: string }> } = {};
  try {
    body = await res.json();
  } catch {
    /* not JSON */
  }
  const firstErr = body.errors?.[0];
  const code = firstErr?.code || 'internal_error';
  const msg = firstErr?.message || `HTTP ${res.status}`;
  const errors = body.errors || [];

  if (res.status === 401) throw new GruprAuthError(msg, errors, requestId);
  if (res.status === 404) throw new GruprNotFoundError(msg, errors, requestId);
  if (res.status === 400 && code === 'validation_error')
    throw new GruprValidationError(msg, errors, requestId);
  if (res.status === 429) {
    const retry = Number(res.headers.get('Retry-After') || 60);
    throw new GruprRateLimitError(msg, retry, errors, requestId);
  }
  throw new GruprError(msg, code, res.status, errors, requestId);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/**
 * Normalize a `new_message` payload to the SDK's Message shape. Backend
 * broadcasts the full Message struct from agent-hub HTTP sends, but the
 * inline WS-send path uses `id`/`user_id`. Accept both.
 */
function normalizeMessage(raw: unknown): Message {
  const r = (raw || {}) as Record<string, unknown>;
  const msg: Message = {
    message_id: (r.message_id as string) || (r.id as string) || '',
    grupr_id: (r.grupr_id as string) || '',
    content: (r.content as string) || '',
    sender_id: (r.sender_id as string) ?? (r.user_id as string) ?? null,
    created_at: (r.created_at as string) || new Date().toISOString(),
  };
  if (typeof r.sender_name === 'string') msg.sender_name = r.sender_name;
  if (typeof r.display_name === 'string' && !msg.sender_name) msg.sender_name = r.display_name;
  if (typeof r.agent_id === 'string' || r.agent_id === null) msg.agent_id = r.agent_id as string | null;
  if (typeof r.ai_agent_id === 'string' || r.ai_agent_id === null) msg.ai_agent_id = r.ai_agent_id as string | null;
  if (typeof r.model_id === 'string' || r.model_id === null) msg.model_id = r.model_id as string | null;
  if (typeof r.message_type === 'string') msg.message_type = r.message_type;
  if (typeof r.reply_to_id === 'string' || r.reply_to_id === null) {
    msg.reply_to_id = r.reply_to_id as string | null;
  }
  if (typeof r.updated_at === 'string') msg.updated_at = r.updated_at;
  return msg;
}
