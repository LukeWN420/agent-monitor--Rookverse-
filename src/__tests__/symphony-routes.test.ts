/**
 * Tests for the /api/symphony/* proxy routes.
 *
 * `fetch` is mocked so we never call a live Symphony dashboard, and the
 * gateway connection singleton is mocked so we never open a WebSocket.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET as sessionsGET } from '@/app/api/symphony/sessions/route';
import { POST as dispatchPOST } from '@/app/api/symphony/dispatch/route';
import { POST as messagePOST } from '@/app/api/symphony/message/route';
import { POST as broadcastPOST } from '@/app/api/symphony/broadcast/route';
import type { SymphonySessionsResponse } from '@/lib/symphony';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/gateway-connection', () => ({
  getGatewayConnection: vi.fn(),
  readOpenClawConfig: vi.fn(),
}));

// Rate limiter mock — always allow in tests
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true, remaining: 99, resetAt: Date.now() + 60000 })),
  clientIp: vi.fn(() => 'test-ip'),
}));

import { getGatewayConnection, readOpenClawConfig } from '@/lib/gateway-connection';

const mockedGetGw = vi.mocked(getGatewayConnection);
const mockedReadCfg = vi.mocked(readOpenClawConfig);

const fetchMock = vi.fn();
const originalFetch = globalThis.fetch;

beforeEach(() => {
  fetchMock.mockReset();
  mockedGetGw.mockReset();
  mockedReadCfg.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  // Default config = present, so message route can proceed.
  mockedReadCfg.mockReturnValue({ token: 'xxx', port: 18789, host: '127.0.0.1' } as any);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeRequest(method: 'GET' | 'POST', body?: unknown, headers?: Record<string, string>): Request {
  return new Request('http://test.local/api/symphony', {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// ---------------------------------------------------------------------------
// /api/symphony/sessions
// ---------------------------------------------------------------------------

describe('GET /api/symphony/sessions', () => {
  it('forwards Symphony sessions payload through to the client', async () => {
    const payload: SymphonySessionsResponse = {
      ok: true,
      count: 1,
      sessions: [
        {
          symphony_id: 'sym-1',
          session_key: 'agent:main:abc',
          agent_id: 'main',
          name: 'Rook',
          emoji: '♜',
          status: 'working',
          task: 'audit',
          issue_identifier: 'DRY-1',
          issue_id: 'mem-1',
          spawned_at: '2026-04-30T14:00:00Z',
          last_active: '2026-04-30T14:00:00Z',
          last_run_id: null,
          extra: {},
        },
      ],
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(payload));

    const res = await sessionsGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.sessions[0].symphony_id).toBe('sym-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns 502 when Symphony is unreachable', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const res = await sessionsGET();
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/unreachable/i);
  });

  it('returns 502 with detail when Symphony returns 5xx', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500));
    const res = await sessionsGET();
    expect(res.status).toBe(502);
  });
});

// ---------------------------------------------------------------------------
// /api/symphony/dispatch
// ---------------------------------------------------------------------------

describe('POST /api/symphony/dispatch', () => {
  it('forwards body to Symphony and returns its response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      exit_code: 0,
      duration_ms: 123,
      symphony_id: 'sym-9',
      session_key: 'agent:main:k9',
      agent_id: 'main',
    }));

    const res = await dispatchPOST(
      makeRequest('POST', { prompt: 'do the thing', name: 'Test-Alpha' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.symphony_id).toBe('sym-9');

    // Verify we called Symphony with the body verbatim.
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toMatchObject({
      prompt: 'do the thing',
      name: 'Test-Alpha',
    });
  });

  it('400 when prompt is missing or empty', async () => {
    expect((await dispatchPOST(makeRequest('POST', {}))).status).toBe(400);
    expect((await dispatchPOST(makeRequest('POST', { prompt: '' }))).status).toBe(400);
    expect((await dispatchPOST(makeRequest('POST', { prompt: '   ' }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('400 when JSON body is malformed', async () => {
    const req = new Request('http://test.local/api/symphony/dispatch', {
      method: 'POST',
      body: 'not json',
    });
    const res = await dispatchPOST(req);
    expect(res.status).toBe(400);
  });

  it('502 when Symphony is unreachable', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const res = await dispatchPOST(makeRequest('POST', { prompt: 'p' }));
    expect(res.status).toBe(502);
  });
});

// ---------------------------------------------------------------------------
// /api/symphony/message
// ---------------------------------------------------------------------------

describe('POST /api/symphony/message', () => {
  it('looks up session_key by symphony_id and forwards via gateway', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      count: 1,
      sessions: [
        {
          symphony_id: 'sym-1',
          session_key: 'agent:main:abc',
          agent_id: 'main',
          name: 'R',
          emoji: '♜',
          status: 'working',
          task: '',
          issue_identifier: '',
          issue_id: '',
          spawned_at: '',
          last_active: '',
          last_run_id: null,
          extra: {},
        },
      ],
    }));
    const requestMock = vi.fn().mockResolvedValue({ ok: true, sent: 'yes' });
    mockedGetGw.mockReturnValue({ request: requestMock } as any);

    const res = await messagePOST(
      makeRequest('POST', { symphony_id: 'sym-1', message: 'hi there' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.session_key).toBe('agent:main:abc');

    expect(requestMock).toHaveBeenCalledTimes(1);
    const [method, params] = requestMock.mock.calls[0];
    expect(method).toBe('chat.send');
    expect(params).toMatchObject({ sessionKey: 'agent:main:abc', message: 'hi there' });
    expect(params.idempotencyKey).toMatch(/^sym-/);
  });

  it('returns 202 with retry hint when the symphony_id is not yet in the registry', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, count: 0, sessions: [] }));
    const res = await messagePOST(
      makeRequest('POST', { symphony_id: 'sym-pending', message: 'ping' }),
    );
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe('pending');
    expect(body.symphony_id).toBe('sym-pending');
    expect(typeof body.retry_after_ms).toBe('number');
    // The gateway should NOT have been called for a pending session.
    expect(mockedGetGw).not.toHaveBeenCalled();
  });

  it('accepts session_key directly and skips the lookup', async () => {
    const requestMock = vi.fn().mockResolvedValue({ ok: true });
    mockedGetGw.mockReturnValue({ request: requestMock } as any);

    const res = await messagePOST(
      makeRequest('POST', { session_key: 'agent:main:direct', message: 'hi' }, { 'x-internal': 'true' }),
    );
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled(); // no registry lookup
    expect(requestMock).toHaveBeenCalled();
  });

  it('400 when message is missing', async () => {
    const res = await messagePOST(makeRequest('POST', { symphony_id: 'sym-1' }));
    expect(res.status).toBe(400);
  });

  it('400 when neither symphony_id nor session_key is supplied', async () => {
    const res = await messagePOST(makeRequest('POST', { message: 'hi' }));
    expect(res.status).toBe(400);
  });

  it('500 when OpenClaw config is missing', async () => {
    mockedReadCfg.mockReturnValueOnce(null as any);
    const res = await messagePOST(
      makeRequest('POST', { session_key: 'agent:main:direct', message: 'hi' }, { 'x-internal': 'true' }),
    );
    expect(res.status).toBe(500);
  });

  it('502 when the gateway request itself fails', async () => {
    const requestMock = vi.fn().mockRejectedValue(new Error('gw down'));
    mockedGetGw.mockReturnValue({ request: requestMock } as any);
    const res = await messagePOST(
      makeRequest('POST', { session_key: 'agent:main:direct', message: 'hi' }, { 'x-internal': 'true' }),
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/gateway send failed/);
  });

  it('accepts camelCase symphonyId / sessionKey aliases', async () => {
    const requestMock = vi.fn().mockResolvedValue({ ok: true });
    mockedGetGw.mockReturnValue({ request: requestMock } as any);
    const res = await messagePOST(
      makeRequest('POST', { sessionKey: 'agent:main:cc', message: 'hi' }, { 'x-internal': 'true' }),
    );
    expect(res.status).toBe(200);
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('403 when session_key is used without X-Internal header', async () => {
    const res = await messagePOST(
      makeRequest('POST', { session_key: 'agent:main:direct', message: 'hi' }),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/X-Internal/);
  });
});


// ---------------------------------------------------------------------------
// /api/symphony/broadcast
// ---------------------------------------------------------------------------

describe('POST /api/symphony/broadcast', () => {
  const sessionA = {
    symphony_id: 'sym-a',
    session_key: 'agent:main:a',
    agent_id: 'main', name: 'Pathfinder', emoji: '🧭', status: 'working',
    task: '', issue_identifier: '', issue_id: '',
    spawned_at: '', last_active: '', last_run_id: null, extra: {},
  };
  const sessionB = {
    ...sessionA, symphony_id: 'sym-b', session_key: 'agent:main:b',
    name: 'Vitalis', emoji: '🩺',
  };

  it('fans out chat.send to every session that has a session_key', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true, count: 2, sessions: [sessionA, sessionB],
    }));
    const requestMock = vi.fn().mockResolvedValue({ ok: true });
    mockedGetGw.mockReturnValue({ request: requestMock } as any);

    const res = await broadcastPOST(
      makeRequest('POST', { message: 'team status?', channel: 'team-room' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.delivered).toHaveLength(2);
    expect(body.failed).toHaveLength(0);

    expect(requestMock).toHaveBeenCalledTimes(2);
    const keys = requestMock.mock.calls.map((c) => (c[1] as { sessionKey: string }).sessionKey);
    expect(keys).toContain('agent:main:a');
    expect(keys).toContain('agent:main:b');
  });

  it('skips sessions without a session_key (still spawning)', async () => {
    const spawning = { ...sessionA, symphony_id: 'sym-spawn', session_key: '', status: 'spawning' };
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true, count: 2, sessions: [sessionA, spawning],
    }));
    const requestMock = vi.fn().mockResolvedValue({ ok: true });
    mockedGetGw.mockReturnValue({ request: requestMock } as any);

    const res = await broadcastPOST(makeRequest('POST', { message: 'hi' }));
    expect(res.status).toBe(200);
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect((requestMock.mock.calls[0][1] as { sessionKey: string }).sessionKey).toBe('agent:main:a');
  });

  it('reports per-session failures via the failed[] array, ok:false if any failed', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true, count: 2, sessions: [sessionA, sessionB],
    }));
    const requestMock = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new Error('session closed'));
    mockedGetGw.mockReturnValue({ request: requestMock } as any);

    const res = await broadcastPOST(makeRequest('POST', { message: 'broken?' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.delivered).toHaveLength(1);
    expect(body.failed).toHaveLength(1);
    expect(body.failed[0].error).toMatch(/session closed/);
  });

  it('400 when message is missing', async () => {
    const res = await broadcastPOST(makeRequest('POST', {}));
    expect(res.status).toBe(400);
  });

  it('400 when no sessions are available to broadcast to', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, count: 0, sessions: [] }));
    const res = await broadcastPOST(makeRequest('POST', { message: 'anyone there?' }));
    expect(res.status).toBe(400);
  });

  it('502 when Symphony is unreachable', async () => {
    fetchMock.mockRejectedValueOnce(new Error('connection refused'));
    const res = await broadcastPOST(makeRequest('POST', { message: 'hi' }));
    expect(res.status).toBe(502);
  });
});
