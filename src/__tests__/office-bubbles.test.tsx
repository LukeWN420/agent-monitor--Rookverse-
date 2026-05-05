/**
 * Tests for the office's bubble-on-transition logic (Phase C).
 *
 * Pre-fix: bubbles only fired on a 30-second cadence (`newTick % 900`).
 * A typical agent turn finishes in 5-10s, so users broadcasting to a
 * team chat saw zero animation in the office — the bubble window
 * usually missed the work entirely.
 *
 * Post-fix:
 *   - Bubbles fire IMMEDIATELY when an agent transitions into an active
 *     behavior (idle → working / thinking / debugging / etc).
 *   - Each agent's bubble uses ITS emoji (post-Symphony-overlay), not a
 *     hardcoded `♜` for everyone.
 *   - statusSummary takes priority over toolName for richer per-agent
 *     bubble text.
 */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useOffice } from '@/hooks/useOffice';
import type { AgentConfig, AgentDashboardState, AgentBehavior } from '@/lib/types';

function agent(id: string, name: string, emoji: string): AgentConfig {
  return {
    id,
    name,
    emoji,
    color: '#000',
    avatar: 'glasses',
    isSubagent: false,
    sendPolicy: 'allow',
    sessionKey: `agent:main:explicit:${id}`,
    sessionKind: 'unknown',
    label: null,
    displayName: null,
    derivedTitle: null,
    lastMessagePreview: null,
    parentId: null,
    parentSessionKey: null,
    rootId: null,
    depth: 0,
    subagentIds: [],
    thinkingLevel: null,
    verboseLevel: null,
    reasoningLevel: null,
    elevatedLevel: null,
    avatarUrl: null,
    identityTheme: null,
  } as AgentConfig;
}

function dashState(behavior: AgentBehavior, overrides?: Partial<AgentDashboardState>): AgentDashboardState {
  return {
    behavior,
    officeState: 'idle',
    currentTask: null,
    taskHistory: [],
    tokenUsage: [],
    totalTokens: 0,
    totalTasks: 0,
    lastActivity: 0,
    sessionLog: [],
    uptime: 0,
    ...overrides,
  };
}

// IMPORTANT: useOffice has a `useEffect(..., [agents])` that resyncs runtimes.
// If the test passes a fresh array literal each render (`[wren]`), the dep
// changes every tick → effect fires → setState → rerender → fresh array →
// infinite loop → OOM. Tests MUST hold a stable agents reference.
//
// Also: `idle` resolves to `break_room` so agents WALK away from their desk
// when idle. The walk keeps them out of Phase D (where bubbles fire) for
// many ticks. To isolate the bubble-on-transition logic, the tests use
// `napping` as the "inactive" state — it resolves to `_own_desk` so the
// agent stays put and Phase D runs every tick.

describe('useOffice — bubbles fire on behavior transitions', () => {
  it('emits a bubble immediately when an agent transitions napping → working', () => {
    const wren = agent('sym-wren', 'Wren', '🐦');
    const wrenAgents = [wren];
    let states: Record<string, AgentDashboardState> = { 'sym-wren': dashState('napping') };

    const { result, rerender } = renderHook(
      ({ s }) => useOffice(wrenAgents, s),
      { initialProps: { s: states } },
    );

    // Steady-state napping ticks at the desk — no bubble (napping is not
    // an active behavior so `justBecameActive` stays false and the cadence
    // path doesn't fire this early).
    act(() => {
      for (let i = 0; i < 5; i++) result.current.tick();
    });
    expect(result.current.officeState.bubbles).toHaveLength(0);

    // Flip to working with a statusSummary — should fire a bubble next tick.
    states = {
      'sym-wren': dashState('working', { statusSummary: 'Reading 3 files' }),
    };
    rerender({ s: states });
    act(() => result.current.tick());

    const bubbles = result.current.officeState.bubbles;
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0].text).toContain('🐦');           // Wren's own emoji
    expect(bubbles[0].text).toContain('Reading 3 files'); // statusSummary
    // Transition bubbles get the longer ttl (180) so the user catches them.
    expect(bubbles[0].ttl).toBeGreaterThan(120);
  });

  it("does NOT fire a bubble while behavior stays inactive (napping → napping)", () => {
    const w = agent('sym-w', 'W', '⚡');
    const wAgents = [w];
    const states: Record<string, AgentDashboardState> = { 'sym-w': dashState('napping') };

    const { result } = renderHook(() => useOffice(wAgents, states));

    act(() => {
      for (let i = 0; i < 10; i++) result.current.tick();
    });
    expect(result.current.officeState.bubbles).toHaveLength(0);
  });

  it('does NOT re-fire a bubble while behavior stays the same (working → working)', () => {
    const w = agent('sym-w', 'W', '⚡');
    const wAgents = [w];
    let states: Record<string, AgentDashboardState> = {
      'sym-w': dashState('working', { statusSummary: 'Streaming' }),
    };

    const { result, rerender } = renderHook(
      ({ s }) => useOffice(wAgents, s),
      { initialProps: { s: states } },
    );

    // First tick after construction: undefined → working IS a transition, fires.
    act(() => result.current.tick());
    expect(result.current.officeState.bubbles).toHaveLength(1);

    // Subsequent ticks while still 'working' must not spawn additional
    // transition bubbles (the cadence path is 30s+ off so it won't fire either).
    states = { 'sym-w': dashState('working', { statusSummary: 'Streaming' }) };
    rerender({ s: states });
    act(() => {
      for (let i = 0; i < 30; i++) result.current.tick();
    });
    // Only the original bubble (TTL ticking down) — no new ones.
    expect(result.current.officeState.bubbles.length).toBeLessThanOrEqual(1);
  });

  it('uses each agents own emoji — no hardcoded ♜ for everyone', () => {
    const wren = agent('sym-wren', 'Wren', '🐦');
    const mirren = agent('sym-mirren', 'Mirren', '🪞');
    const pairAgents = [wren, mirren];
    let states: Record<string, AgentDashboardState> = {
      'sym-wren': dashState('napping'),
      'sym-mirren': dashState('napping'),
    };

    const { result, rerender } = renderHook(
      ({ s }) => useOffice(pairAgents, s),
      { initialProps: { s: states } },
    );

    act(() => result.current.tick()); // settle initial napping

    states = {
      'sym-wren': dashState('working', { statusSummary: 'Reading' }),
      'sym-mirren': dashState('thinking', { statusSummary: 'Reflecting' }),
    };
    rerender({ s: states });
    act(() => result.current.tick());

    const texts = result.current.officeState.bubbles.map((b) => b.text);
    // Each agent's bubble carries their own identity emoji.
    expect(texts.some((t) => t.includes('🐦') && t.includes('Reading'))).toBe(true);
    expect(texts.some((t) => t.includes('🪞') && t.includes('Reflecting'))).toBe(true);
    // No hardcoded rook on a non-Rook agent.
    expect(texts.every((t) => !(t.includes('♜') && t.includes('Reading')))).toBe(true);
  });

  it('falls back to toolName when statusSummary is absent', () => {
    const w = agent('sym-w', 'Worker', '🔥');
    const wAgents = [w];
    let states: Record<string, AgentDashboardState> = { 'sym-w': dashState('napping') };

    const { result, rerender } = renderHook(
      ({ s }) => useOffice(wAgents, s),
      { initialProps: { s: states } },
    );
    act(() => result.current.tick());

    states = { 'sym-w': dashState('working', { toolName: 'read_file' }) };
    rerender({ s: states });
    act(() => result.current.tick());

    const bubble = result.current.officeState.bubbles[0];
    expect(bubble.text).toContain('🔥');
    expect(bubble.text).toContain('read_file');
  });
});
