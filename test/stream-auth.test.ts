import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { GruprClient, type Message } from '../src';
import pkg from '../package.json';

// A fixture string, not a credential.
const TOKEN = 'gat_fake_fixture_not_a_real_token';
const GRUPR_ID = '00000000-0000-4000-8000-000000000001';

interface FakeApi {
  baseUrl: string;
  upgrades: Array<{ url: string; headers: IncomingHttpHeaders }>;
  frames: unknown[];
  close: () => Promise<void>;
}

/**
 * A fake Grupr API that is stricter than the real one: it accepts a
 * WebSocket upgrade only when the token is in `Authorization: Bearer` and
 * there is no `token` query parameter. On join_channel it pushes one
 * new_message, the way the real hub does when someone posts.
 */
async function startFakeApi(): Promise<FakeApi> {
  const upgrades: FakeApi['upgrades'] = [];
  const frames: unknown[] = [];
  const wss = new WebSocketServer({ noServer: true });
  const server = createServer((_req, res) => {
    res.statusCode = 404;
    res.end();
  });

  server.on('upgrade', (req, socket, head) => {
    const url = req.url ?? '';
    upgrades.push({ url, headers: req.headers });
    const query = new URL(url, 'http://fake.invalid').searchParams;
    const ok = req.headers.authorization === `Bearer ${TOKEN}` && !query.has('token');
    if (!ok) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on('message', (data) => {
        const event = JSON.parse(data.toString()) as { type?: string };
        frames.push(event);
        if (event.type === 'join_channel') {
          ws.send(
            JSON.stringify({
              type: 'new_message',
              payload: {
                id: 'msg-1',
                grupr_id: GRUPR_ID,
                content: 'hello from the fake hub',
                user_id: 'user-1',
                created_at: '2026-11-23T12:00:00Z',
              },
            }),
          );
        }
      });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}/api/v1/agent-hub`,
    upgrades,
    frames,
    close: async () => {
      for (const c of wss.clients) c.terminate();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** HTTP backlog drain: always empty, so the client goes straight to the stream. */
const emptyBacklogFetch: typeof fetch = async () =>
  new Response(JSON.stringify({ data: [], meta: { count: 0 } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

/** First streamed message, or undefined if none arrives within timeoutMs. */
async function firstMessage(client: GruprClient, timeoutMs = 3000): Promise<Message | undefined> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    for await (const msg of client.streamEvents(GRUPR_ID, {
      signal: ac.signal,
      since: '2026-11-23T00:00:00Z',
      initialBackoffMs: 20,
      maxBackoffMs: 100,
    })) {
      return msg;
    }
    return undefined;
  } finally {
    clearTimeout(timer);
    ac.abort();
  }
}

describe('streamEvents WebSocket authentication', () => {
  let api: FakeApi | undefined;

  afterEach(async () => {
    await api?.close();
    api = undefined;
  });

  it('sends the agent token in the Authorization header and never in the URL', async () => {
    api = await startFakeApi();
    const client = new GruprClient({
      agentToken: TOKEN,
      baseUrl: api.baseUrl,
      fetch: emptyBacklogFetch,
    });

    const msg = await firstMessage(client);

    expect(api.upgrades.length).toBeGreaterThan(0);
    const upgrade = api.upgrades[0];
    expect(upgrade.headers.authorization).toBe(`Bearer ${TOKEN}`);
    const url = new URL(upgrade.url, 'http://fake.invalid');
    expect(url.pathname).toBe('/ws');
    expect(url.searchParams.has('token')).toBe(false);
    for (const u of api.upgrades) {
      expect(u.url.includes(TOKEN)).toBe(false);
    }

    // The stream itself works end to end over the header-authenticated socket.
    expect(api.frames[0]).toEqual({
      type: 'join_channel',
      payload: { channel: `grupr:${GRUPR_ID}:members` },
    });
    expect(msg?.message_id).toBe('msg-1');
    expect(msg?.content).toBe('hello from the fake hub');
  });

  it('names the SDK and its package.json version in the User-Agent', async () => {
    api = await startFakeApi();
    const client = new GruprClient({
      agentToken: TOKEN,
      baseUrl: api.baseUrl,
      fetch: emptyBacklogFetch,
    });

    await firstMessage(client);

    expect(api.upgrades[0]?.headers['user-agent']).toBe(`grupr-sdk-typescript/${pkg.version}`);
  });

  it('uses a caller-supplied userAgent on the upgrade', async () => {
    api = await startFakeApi();
    const client = new GruprClient({
      agentToken: TOKEN,
      baseUrl: api.baseUrl,
      fetch: emptyBacklogFetch,
      userAgent: 'my-bot/1.2.3',
    });

    await firstMessage(client);

    expect(api.upgrades[0]?.headers['user-agent']).toBe('my-bot/1.2.3');
    expect(api.upgrades[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`);
  });
});
