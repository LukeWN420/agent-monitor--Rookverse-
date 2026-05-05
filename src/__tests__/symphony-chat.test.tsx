import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { fireEvent, render, screen } from '@testing-library/react';

import AgentMeeting from '@/components/meeting/AgentMeeting';
import { useSymphonyChat } from '@/components/meeting/useSymphonyChat';

const fetchMock = vi.fn();
const originalFetch = globalThis.fetch;

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const sampleSession = {
  symphony_id: 'sym-1',
  session_key: 'agent:main:abc',
  agent_id: 'main',
  name: 'Research-Alpha',
  emoji: '🔬',
  status: 'working',
  task: 'Gas fee analysis',
  issue_identifier: 'DRY-1',
  issue_id: 'mem-1',
  spawned_at: '2026-04-30T14:00:00Z',
  last_active: '2026-04-30T14:00:00Z',
  last_run_id: null,
  extra: {},
};

describe('useSymphonyChat — roster + send', () => {
  it('populates the roster from /api/symphony/sessions on activate', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, count: 1, sessions: [sampleSession] }));

    const { result } = renderHook(({ active }) => useSymphonyChat({ isActive: active }), {
      initialProps: { active: false },
    });

    expect(result.current.sessions).toEqual([]);
    expect(result.current.isReady).toBe(false);

    act(() => {
      result.current.startMeeting();
    });

    // The first effect run after isActive=true triggers refreshRoster.
    // We don't actually flip isActive in this hook test (effect hangs off
    // it); call refreshRoster directly to assert the wiring.
    await act(async () => {
      await result.current.refreshRoster();
    });

    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.sessions[0].symphony_id).toBe('sym-1');
    expect(result.current.isReady).toBe(true);
  });

  it('records a roster error when Symphony is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const { result } = renderHook(() => useSymphonyChat({ isActive: false }));
    await act(async () => {
      await result.current.refreshRoster();
    });
    expect(result.current.rosterError).toMatch(/ECONNREFUSED/);
    expect(result.current.isReady).toBe(false);
  });

  it('sendToSession optimistically appends a user message and POSTs to /api/symphony/message', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, status: 'sent' }));
    const { result } = renderHook(() => useSymphonyChat({ isActive: false }));

    let res: Awaited<ReturnType<typeof result.current.sendToSession>>;
    await act(async () => {
      res = await result.current.sendToSession('sym-1', 'hi there');
    });

    expect(res!.ok).toBe(true);
    // Optimistic message landed.
    const last = result.current.messages.at(-1)!;
    expect(last.content).toBe('hi there');
    expect(last.role).toBe('user');
    expect(last.id).toMatch(/^local-/);

    // POSTed to the right route with the right body.
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/symphony/message');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ symphony_id: 'sym-1', message: 'hi there' });
  });

  it('retries once on 202 pending and surfaces pending status if still 202', async () => {
    vi.useFakeTimers();
    // First call: 202. Second call (after retry): also 202.
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ status: 'pending', retry_after_ms: 50 }, 202))
      .mockResolvedValueOnce(jsonResponse({ status: 'pending', retry_after_ms: 50 }, 202));

    const { result } = renderHook(() => useSymphonyChat({ isActive: false }));

    let res: Awaited<ReturnType<typeof result.current.sendToSession>>;
    const promise = act(async () => {
      res = await result.current.sendToSession('sym-pending', 'hi');
    });
    // Drive the back-off timer.
    await vi.advanceTimersByTimeAsync(60);
    await promise;

    expect(res!.ok).toBe(false);
    expect(res!.status).toBe('pending');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns ok:false with the server error on non-2xx final response', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'gateway boom' }, 502));
    const { result } = renderHook(() => useSymphonyChat({ isActive: false }));
    let res: Awaited<ReturnType<typeof result.current.sendToSession>>;
    await act(async () => {
      res = await result.current.sendToSession('sym-1', 'hi');
    });
    expect(res!.ok).toBe(false);
    expect(res!.status).toBe('error');
    expect(res!.error).toMatch(/gateway boom/);
  });

  it('rejects empty messages without calling fetch', async () => {
    const { result } = renderHook(() => useSymphonyChat({ isActive: false }));
    let res: Awaited<ReturnType<typeof result.current.sendToSession>>;
    await act(async () => {
      res = await result.current.sendToSession('sym-1', '   ');
    });
    expect(res!.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('AgentMeeting — render', () => {
  it('renders the pre-meeting view with a Start Meeting button', () => {
    render(<AgentMeeting />);
    expect(screen.getByText(/Meeting Room/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start meeting/i })).toBeInTheDocument();
  });

  it('starts a meeting and shows the connecting state', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, count: 1, sessions: [sampleSession] }));
    render(<AgentMeeting />);
    fireEvent.click(screen.getByRole('button', { name: /start meeting/i }));

    // Wait for the roster to land.
    await waitFor(() => {
      expect(screen.getByText('Research-Alpha')).toBeInTheDocument();
    });
    expect(screen.getByText(/1 agent/)).toBeInTheDocument();
  });

  it('disables Send when no agent is selected', () => {
    render(<AgentMeeting />);
    fireEvent.click(screen.getByRole('button', { name: /start meeting/i }));
    expect(screen.getByRole('button', { name: /^send$/i })).toBeDisabled();
  });

  it('routes a typed message to /api/symphony/broadcast when no @mention is given', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/api/symphony/sessions')) {
        return jsonResponse({ ok: true, count: 1, sessions: [sampleSession] });
      }
      if (url.includes('/api/symphony/broadcast')) {
        return jsonResponse({ ok: true, delivered: [{ session_key: 'agent:main:abc' }], failed: [] });
      }
      return jsonResponse({ ok: true, result: { messages: [] } });
    });

    render(<AgentMeeting />);
    fireEvent.click(screen.getByRole('button', { name: /start meeting/i }));
    await waitFor(() => expect(screen.getByText('Research-Alpha')).toBeInTheDocument());

    const input = screen.getByPlaceholderText(/message/i);
    fireEvent.change(input, { target: { value: 'team status check' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() => {
      const broadcastCall = fetchMock.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('/api/symphony/broadcast'),
      );
      expect(broadcastCall).toBeTruthy();
    });
    const broadcastCall = fetchMock.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('/api/symphony/broadcast'),
    )!;
    const body = JSON.parse((broadcastCall[1] as RequestInit).body as string);
    expect(body).toMatchObject({ message: 'team status check', channel: 'team-room' });
  });

  it('routes a @mention message via /api/symphony/message, not broadcast', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/api/symphony/sessions')) {
        return jsonResponse({ ok: true, count: 1, sessions: [sampleSession] });
      }
      if (url.includes('/api/symphony/message')) {
        return jsonResponse({ ok: true, session_key: 'agent:main:abc' });
      }
      return jsonResponse({ ok: true, result: { messages: [] } });
    });

    render(<AgentMeeting />);
    fireEvent.click(screen.getByRole('button', { name: /start meeting/i }));
    await waitFor(() => expect(screen.getByText('Research-Alpha')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText(/message/i), {
      target: { value: '@Research-Alpha can you confirm?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() => {
      const directCall = fetchMock.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('/api/symphony/message'),
      );
      expect(directCall).toBeTruthy();
    });
    const broadcastCall = fetchMock.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('/api/symphony/broadcast'),
    );
    expect(broadcastCall).toBeUndefined();
    const directCall = fetchMock.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('/api/symphony/message'),
    )!;
    const body = JSON.parse((directCall[1] as RequestInit).body as string);
    // @mention prefix is stripped before forwarding.
    expect(body.message).toBe('can you confirm?');
    expect(body.symphony_id).toBe('sym-1');
  });

  it('suppresses echoes of user-role history entries (no per-session duplicates)', async () => {
    // Each session's history contains the SAME user broadcast — without the
    // suppression, the timeline would show N copies attributed to each agent.
    const sharedUserMsg = {
      id: 'broadcast-1',
      role: 'user',
      content: 'team status check',
      timestamp: 1_700_000_000_000,
    };
    const sessionTwo = {
      ...sampleSession,
      symphony_id: 'sym-2',
      session_key: 'agent:main:def',
      name: 'Vitalis',
      emoji: '🩺',
    };
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/api/symphony/sessions')) {
        return jsonResponse({ ok: true, count: 2, sessions: [sampleSession, sessionTwo] });
      }
      if (url.includes('/api/gateway/action')) {
        const body = JSON.parse((init?.body as string) || '{}');
        if (body.action === 'history') {
          return jsonResponse({
            ok: true,
            result: {
              messages: [sharedUserMsg, {
                id: `reply-${body.sessionKey}`,
                role: 'assistant',
                content: `reply from ${body.sessionKey}`,
                timestamp: 1_700_000_000_001,
              }],
            },
          });
        }
      }
      return jsonResponse({ ok: true });
    });

    render(<AgentMeeting />);
    fireEvent.click(screen.getByRole('button', { name: /start meeting/i }));
    await waitFor(() => expect(screen.getByText('Research-Alpha')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/reply from agent:main:abc/)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/reply from agent:main:def/)).toBeInTheDocument());

    // The shared user message must NOT appear at all (no optimistic was
    // sent — we only render assistant replies from history).
    expect(screen.queryAllByText('team status check')).toHaveLength(0);
  });

  it('opens a Dispatch form, POSTs to /api/symphony/dispatch, and refreshes the roster', async () => {
    // URL-based mock so history-poll fetches that fire as a side-effect of
    // the new session appearing don't consume the dispatch responses.
    let dispatched = false;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/api/symphony/dispatch')) {
        dispatched = true;
        return jsonResponse(
          {
            ok: true,
            status: 'spawning',
            symphony_id: 'sym-new',
            session_key: null,
            agent_id: null,
          },
          202,
        );
      }
      if (url.includes('/api/symphony/sessions')) {
        return jsonResponse({
          ok: true,
          count: dispatched ? 1 : 0,
          sessions: dispatched
            ? [{ ...sampleSession, symphony_id: 'sym-new', name: 'Dispatched-1' }]
            : [],
        });
      }
      // History-poll target — return an empty history so the roster
      // render path stays clean.
      return jsonResponse({ ok: true, result: { messages: [] } });
    });

    render(<AgentMeeting />);
    fireEvent.click(screen.getByRole('button', { name: /start meeting/i }));
    await waitFor(() => expect(screen.getByText(/no active sessions yet/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /\+ dispatch/i }));
    fireEvent.change(screen.getByPlaceholderText(/initial prompt/i), {
      target: { value: 'do the work' },
    });
    fireEvent.change(screen.getByPlaceholderText(/display name/i), {
      target: { value: 'Dispatched-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^dispatch$/i }));

    await waitFor(() => expect(screen.getByText('Dispatched-1')).toBeInTheDocument());

    // The dispatch call should target /api/symphony/dispatch with the
    // form values, including persistent: true (default).
    const dispatchCall = fetchMock.mock.calls.find(
      (call) => typeof call[0] === 'string' && (call[0] as string).includes('/api/symphony/dispatch'),
    );
    expect(dispatchCall).toBeTruthy();
    const body = JSON.parse((dispatchCall![1] as RequestInit).body as string);
    expect(body).toMatchObject({ prompt: 'do the work', name: 'Dispatched-1', persistent: true });
  });
});
