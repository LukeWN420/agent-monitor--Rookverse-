/**
 * Tests for the Symphony-identity overlay in `/api/gateway`.
 *
 * Pre-fix: every `agent:main:explicit:sym-*` session collapsed into a
 * single "Main" entry via `canonicalSessionLookupKey` (it returned
 * `agent:main` for any 2-segment-prefix match). Wren, Pathfinder, Mirren
 * and friends were silently merged into one row before reaching the
 * dashboard — and even if they had survived, every "main" agent
 * rendered with the same ♜ emoji + gold color + glasses avatar.
 *
 * Post-fix:
 *   1. `canonicalSessionLookupKey` keeps `:explicit:` keys distinct.
 *   2. `extractExplicitId` pulls the symphony-side id out of a key.
 *   3. The route overlays Symphony's `name` / `emoji` onto explicit
 *      sessions when Symphony is reachable.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GET as gatewayGET,
  canonicalSessionLookupKey,
  extractExplicitId,
} from '@/app/api/gateway/route';

vi.mock('@/lib/gateway-connection', () => ({
  getGatewayConnection: vi.fn(),
  readOpenClawConfig: vi.fn(),
}));
vi.mock('@/lib/autowork', () => ({
  ensureAutoworkTicker: vi.fn(),
}));
vi.mock('@/lib/symphony', async () => {
  const actual = await vi.importActual<typeof import('@/lib/symphony')>('@/lib/symphony');
  return {
    ...actual,
    fetchSessions: vi.fn(),
  };
});

import { getGatewayConnection, readOpenClawConfig } from '@/lib/gateway-connection';
import { fetchSessions as fetchSymphonySessions } from '@/lib/symphony';

const mockedGw = vi.mocked(getGatewayConnection);
const mockedCfg = vi.mocked(readOpenClawConfig);
const mockedSym = vi.mocked(fetchSymphonySessions);

beforeEach(() => {
  mockedGw.mockReset();
  mockedCfg.mockReset();
  mockedSym.mockReset();
  mockedCfg.mockReturnValue({ token: 'x', port: 18789, host: '127.0.0.1' } as unknown as ReturnType<typeof readOpenClawConfig>);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('canonicalSessionLookupKey', () => {
  it('collapses channel variants of the same identity', () => {
    expect(canonicalSessionLookupKey('agent:main:main')).toBe('agent:main');
    expect(canonicalSessionLookupKey('agent:main:discord:direct:725')).toBe('agent:main');
  });

  it('keeps subagent keys distinct', () => {
    const k = 'agent:main:subagent:abcdef';
    expect(canonicalSessionLookupKey(k)).toBe(k);
  });

  it('keeps Symphony explicit sessions distinct (the load-bearing fix)', () => {
    expect(canonicalSessionLookupKey('agent:main:explicit:sym-1')).toBe('agent:main:explicit:sym-1');
    expect(canonicalSessionLookupKey('agent:main:explicit:sym-2')).toBe('agent:main:explicit:sym-2');
    // Without this, the dedup map merged every Symphony-managed agent
    // into the operator's main row.
  });
});

describe('extractExplicitId', () => {
  it('returns the id for explicit sessions', () => {
    expect(extractExplicitId('agent:main:explicit:sym-manual-1234')).toBe('sym-manual-1234');
    expect(extractExplicitId('agent:codex:explicit:sym-x')).toBe('sym-x');
  });

  it('returns null for non-explicit sessions', () => {
    expect(extractExplicitId('agent:main:main')).toBeNull();
    expect(extractExplicitId('agent:main:subagent:abc')).toBeNull();
    expect(extractExplicitId('not-a-key')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// /api/gateway route — Symphony overlay end-to-end
// ---------------------------------------------------------------------------

function symphonySession(symphonyId: string, name: string, emoji: string) {
  return {
    symphony_id: symphonyId,
    session_key: `agent:main:explicit:${symphonyId}`,
    agent_id: 'main',
    name,
    emoji,
    status: 'working',
    task: '',
    issue_identifier: '',
    issue_id: '',
    spawned_at: '',
    last_active: '',
    last_run_id: null,
    extra: {},
  };
}

function gatewaySession(key: string, totalTokens = 100) {
  return {
    sessionId: `sid-${key}`,
    key,
    model: 'glm-5.1:cloud',
    modelProvider: 'ollama',
    inputTokens: totalTokens, outputTokens: 0, totalTokens, contextTokens: 200_000,
    updatedAt: Date.now(),
    abortedLastRun: false,
    sendPolicy: 'allow',
  };
}

describe('GET /api/gateway — Symphony identity overlay', () => {
  it('preserves each Symphony explicit session as a distinct row, with overlay name + emoji', async () => {
    mockedGw.mockReturnValue({
      request: vi.fn().mockResolvedValue({
        sessions: [
          gatewaySession('agent:main:main', 1000),
          gatewaySession('agent:main:explicit:sym-wren', 200),
          gatewaySession('agent:main:explicit:sym-mirren', 300),
          gatewaySession('agent:main:explicit:sym-pathfinder', 150),
        ],
      }),
      getSessionStates: () => new Map(),
      getAgents: () => new Map(),
    } as unknown as ReturnType<typeof getGatewayConnection>);

    mockedSym.mockResolvedValue({
      ok: true, count: 3,
      sessions: [
        symphonySession('sym-wren', 'Wren', '🐦'),
        symphonySession('sym-mirren', 'Mirren', '🪞'),
        symphonySession('sym-pathfinder', 'Pathfinder', '🧭'),
      ],
    });

    const res = await gatewayGET();
    const body = await res.json();
    expect(body.ok).toBe(true);

    const byKey = new Map(body.sessions.map((s: { key: string }) => [s.key, s]));
    expect(byKey.size).toBe(4);

    // The three Symphony explicits are NOT collapsed into agent:main.
    expect(byKey.get('agent:main:explicit:sym-wren')).toBeTruthy();
    expect(byKey.get('agent:main:explicit:sym-mirren')).toBeTruthy();
    expect(byKey.get('agent:main:explicit:sym-pathfinder')).toBeTruthy();

    // Overlay applied: name + emoji from Symphony, not gateway defaults.
    const wren = byKey.get('agent:main:explicit:sym-wren') as { name: string; emoji: string; symphonyId: string };
    expect(wren.name).toBe('Wren');
    expect(wren.emoji).toBe('🐦');
    expect(wren.symphonyId).toBe('sym-wren');

    const mirren = byKey.get('agent:main:explicit:sym-mirren') as { name: string; emoji: string };
    expect(mirren.name).toBe('Mirren');
    expect(mirren.emoji).toBe('🪞');
  });

  it('still surfaces explicit sessions as distinct even when Symphony is unreachable', async () => {
    mockedGw.mockReturnValue({
      request: vi.fn().mockResolvedValue({
        sessions: [
          gatewaySession('agent:main:explicit:sym-orphan-a'),
          gatewaySession('agent:main:explicit:sym-orphan-b'),
        ],
      }),
      getSessionStates: () => new Map(),
      getAgents: () => new Map(),
    } as unknown as ReturnType<typeof getGatewayConnection>);

    // Symphony down — fetch throws.
    mockedSym.mockRejectedValue(new Error('Symphony unreachable'));

    const res = await gatewayGET();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.sessions).toHaveLength(2);
    // Names fall back to the readBotName() default (which is fine — the key
    // point is the dedup didn't collapse them into a single row).
    const keys = body.sessions.map((s: { key: string }) => s.key).sort();
    expect(keys).toEqual([
      'agent:main:explicit:sym-orphan-a',
      'agent:main:explicit:sym-orphan-b',
    ]);
    // symphonyId is still propagated from the key, so the client can derive
    // distinct color/avatar even without a Symphony overlay.
    expect(body.sessions[0].symphonyId).toMatch(/^sym-orphan-/);
  });

  it("treats Symphony's default '♜' emoji as unset so explicits don't all render as rooks", async () => {
    // Symphony stamps '♜' on every dispatch unless an emoji is explicitly
    // provided. If we let that bleed through to the client, every
    // Symphony agent renders identically. The route must filter it out
    // and let the client's slot picker derive a unique emoji per agent.
    mockedGw.mockReturnValue({
      request: vi.fn().mockResolvedValue({
        sessions: [
          gatewaySession('agent:main:explicit:sym-default-emoji'),
          gatewaySession('agent:main:explicit:sym-custom-emoji'),
        ],
      }),
      getSessionStates: () => new Map(),
      getAgents: () => new Map(),
    } as unknown as ReturnType<typeof getGatewayConnection>);

    mockedSym.mockResolvedValue({
      ok: true, count: 2,
      sessions: [
        symphonySession('sym-default-emoji', 'DefaultEmoji', '♜'),
        symphonySession('sym-custom-emoji', 'CustomEmoji', '🦊'),
      ],
    });

    const res = await gatewayGET();
    const body = await res.json();
    const byKey = new Map(body.sessions.map((s: { key: string }) => [s.key, s]));
    const def = byKey.get('agent:main:explicit:sym-default-emoji') as { emoji?: string };
    const cus = byKey.get('agent:main:explicit:sym-custom-emoji') as { emoji?: string };

    // Default '♜' is filtered out — emoji is unset and client will derive.
    expect(def.emoji).toBeUndefined();
    // Custom emoji passes through.
    expect(cus.emoji).toBe('🦊');
  });

  it('does not overlay Symphony identity onto the operator main session', async () => {
    mockedGw.mockReturnValue({
      request: vi.fn().mockResolvedValue({
        sessions: [gatewaySession('agent:main:main', 5000)],
      }),
      getSessionStates: () => new Map(),
      getAgents: () => new Map(),
    } as unknown as ReturnType<typeof getGatewayConnection>);

    // Even a Symphony session with the same agent_id 'main' should NOT
    // bleed into the operator's main row — overlay matches by symphony_id,
    // not agent id.
    mockedSym.mockResolvedValue({
      ok: true, count: 1,
      sessions: [symphonySession('sym-other', 'NotMain', '🦊')],
    });

    const res = await gatewayGET();
    const body = await res.json();
    const main = body.sessions.find((s: { key: string }) => s.key === 'agent:main:main');
    expect(main).toBeTruthy();
    expect(main.name).not.toBe('NotMain');
    expect(main.symphonyId).toBeNull();
  });
});
