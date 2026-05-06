// ============================================================================
// /api/gateway — Proxy to OpenClaw Gateway
//
// Returns real session data as JSON for the dashboard to poll.
// Uses a persistent WebSocket connection (singleton) instead of opening a
// new connection per request. Raw chatStatus and agentStatus are passed
// through from gateway events alongside the derived behavior.
// ============================================================================

import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ensureAutoworkTicker } from '@/lib/autowork';
import {
  getGatewayConnection,
  readOpenClawConfig,
  type SessionsListResult,
} from '@/lib/gateway-connection';
import {
  executionStateToBehavior,
  getToolSnapshot,
  isActiveBehavior,
  summarizeExecution,
} from '@/lib/state-mapper';
import { fetchSessions as fetchSymphonySessions, type SymphonySession } from '@/lib/symphony';

/** Read bot name from IDENTITY.md **Name:** field */
function readBotName(): string | null {
  try {
    const workspace = process.env.OPENCLAW_WORKSPACE
      ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '', 'clawd');
    const content = readFileSync(join(workspace, 'IDENTITY.md'), 'utf-8');
    const match = content.match(/\*\*Name:\*\*\s*(.+)/);
    return match?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

/**
 * Group key used to dedupe sessions that represent the same logical agent
 * identity. `agent:main:main` and `agent:main:discord:direct:...` ARE the
 * same identity (Rook on different channels), so they collapse to
 * `agent:main`. Subagents and Symphony-managed `:explicit:` sessions are
 * distinct identities and must NOT collapse — that's what was hiding
 * Wren/Pathfinder/Mirren behind a single "Main" entry.
 *
 * Exported so the test suite can pin the dedup contract.
 */
export function canonicalSessionLookupKey(key: string): string {
  if (key.includes('subagent')) return key;
  if (key.includes(':explicit:')) return key;
  const parts = key.split(':');
  if (parts[0] === 'agent' && parts[1]) {
    return parts.slice(0, 2).join(':');
  }
  return key;
}

/**
 * Pull the Symphony-side id out of a gateway session key.
 * `agent:main:explicit:sym-manual-1234` -> `sym-manual-1234`
 * Returns null for non-explicit keys.
 */
export function extractExplicitId(key: string): string | null {
  const marker = ':explicit:';
  const idx = key.indexOf(marker);
  return idx >= 0 ? key.slice(idx + marker.length) : null;
}

function inferParentSessionKey(key: string): string | null {
  const parts = key.split(':');
  const idx = parts.lastIndexOf('subagent');
  if (idx <= 1) return null;
  return parts.slice(0, idx).join(':');
}

export async function GET() {
  const config = readOpenClawConfig();
  if (!config) {
    return NextResponse.json(
      { error: 'OpenClaw config not found', sessions: [] },
      { status: 500 },
    );
  }

  try {
    ensureAutoworkTicker();
    const gw = getGatewayConnection();

    // Fetch session metadata via RPC (uses persistent connection if ready,
    // falls back to ephemeral WebSocket otherwise).
    const result = await gw.request<SessionsListResult>('sessions.list', {});
    const now = Date.now();

    // Get live execution states from event subscriptions
    const liveStates = gw.getSessionStates();

    // Get known agents for display names / emoji
    const knownAgents = gw.getAgents();

    // Pull Symphony's persistent-session registry as a best-effort overlay so
    // explicit sessions (`agent:*:explicit:sym-*`) surface with their named
    // identities (Wren, Pathfinder, etc.) instead of all collapsing to the
    // operator's main agent. If Symphony is unreachable we just skip the
    // overlay — gateway data still flows.
    const symphonyByExplicitId = new Map<string, SymphonySession>();
    try {
      const sym = await fetchSymphonySessions();
      for (const s of sym.sessions ?? []) {
        if (s.symphony_id) symphonyByExplicitId.set(s.symphony_id, s);
      }
    } catch {
      // Symphony down — proceed without overlay.
    }

    const sessions = (result.sessions ?? []).map((s) => {
      const isSubagent = s.key.includes('subagent');

      // Derive behavior from real-time event state (if available)
      // combined with session metadata (abortedLastRun as fallback).
      const liveState = liveStates.get(s.key);
      const behavior = executionStateToBehavior(liveState, s.abortedLastRun);
      const isActive = isActiveBehavior(behavior);
      const { toolName, toolPhase } = getToolSnapshot(liveState?.agentEventData);

      // Resolve agent info from agents map, fall back to session key parsing
      const keyParts = s.key.split(':');
      const agentId = (keyParts[0] === 'agent' && keyParts[1]) ? keyParts[1] : 'main';
      const agentInfo = liveState?.agent ?? knownAgents.get(agentId);

      // Symphony overlay — if this is an explicit session and Symphony has
      // a name/emoji for it, those take precedence over the agent map's
      // generic identity (which would otherwise tag every Wren / Mirren /
      // Pathfinder as plain "Main" + ♜).
      const explicitId = extractExplicitId(s.key);
      const symphonyOverlay = explicitId ? symphonyByExplicitId.get(explicitId) : null;

      let agentName: string;
      let resolvedEmoji: string | undefined = agentInfo?.identity?.emoji;
      if (symphonyOverlay?.name) {
        agentName = symphonyOverlay.name;
        // Only overlay Symphony's emoji if it's a genuinely-chosen one.
        // Symphony stamps '♜' on every dispatch by default; treating that
        // as a real emoji would make Wren / Mirren / Health-Watcher all
        // render as the operator's rook again. Anything else (🐦, 🪞,
        // custom-set per dispatch) wins.
        if (symphonyOverlay.emoji && symphonyOverlay.emoji !== '♜') {
          resolvedEmoji = symphonyOverlay.emoji;
        }
      } else if (agentInfo?.identity?.name ?? agentInfo?.name) {
        agentName = (agentInfo.identity?.name ?? agentInfo.name)!;
      } else if (isSubagent) {
        const subId = keyParts[keyParts.length - 1] ?? '';
        agentName = `Sub-${subId.slice(0, 6)}`;
      } else {
        agentName = readBotName() ?? agentId.charAt(0).toUpperCase() + agentId.slice(1);
      }

      return {
        id: s.sessionId ?? s.key,
        key: s.key,
        name: agentName,
        emoji: resolvedEmoji,
        // Surface the explicit-session id so the client can derive a
        // deterministic per-Symphony-agent color/avatar without re-parsing
        // the session key. Null for non-explicit sessions.
        symphonyId: explicitId,
        modelProvider: s.modelProvider ?? null,
        model: s.model ?? 'unknown',
        inputTokens: s.inputTokens ?? 0,
        outputTokens: s.outputTokens ?? 0,
        totalTokens: s.totalTokens ?? 0,
        contextTokens: s.contextTokens ?? 0,
        channel: s.lastChannel ?? s.channel ?? 'default',
        kind: s.kind ?? 'unknown',
        label: s.label ?? null,
        displayName: s.displayName ?? null,
        derivedTitle: s.derivedTitle ?? null,
        lastMessagePreview: s.lastMessagePreview ?? null,
        // Raw statuses from gateway events (recorded as-is)
        chatStatus: liveState?.chatStatus ?? null,
        agentStatus: liveState?.agentStatus ?? null,
        agentEventData: liveState?.agentEventData ?? null,
        currentToolName: toolName,
        currentToolPhase: toolPhase,
        statusSummary: summarizeExecution({
          behavior,
          agentStatus: liveState?.agentStatus ?? null,
          chatStatus: liveState?.chatStatus ?? null,
          agentEventData: liveState?.agentEventData ?? null,
          isSubagent,
        }),
        parentSessionId: null as string | null,
        parentSessionKey: null as string | null,
        rootSessionId: null as string | null,
        childSessionIds: [] as string[],
        depth: s.key.split(':').filter((part) => part === 'subagent').length,
        sendPolicy: s.sendPolicy ?? null,
        thinkingLevel: s.thinkingLevel ?? null,
        verboseLevel: s.verboseLevel ?? null,
        reasoningLevel: s.reasoningLevel ?? null,
        elevatedLevel: s.elevatedLevel ?? null,
        avatarUrl: agentInfo?.identity?.avatarUrl ?? null,
        identityTheme: agentInfo?.identity?.theme ?? null,
        lastRunId: liveState?.lastRunId ?? null,
        // Derived behavior for backward compat with office view
        behavior,
        isActive,
        isSubagent,
        lastActivity: s.updatedAt,
        updatedAt: s.updatedAt,
        aborted: s.abortedLastRun ?? false,
      };
    });

    // Deduplicate: if multiple sessions share the same agent prefix
    // (e.g. agent:main:main and agent:main), keep the one with more tokens
    const sessionMap = new Map<string, typeof sessions[0]>();
    for (const sess of sessions) {
      // Group key: for "agent:main:main" -> "agent:main", for subagents keep full key
      const groupKey = sess.isSubagent ? sess.key : canonicalSessionLookupKey(sess.key);
      const existing = sessionMap.get(groupKey);
      if (!existing) {
        sessionMap.set(groupKey, sess);
      } else {
        // Prefer the session that is more recently active or currently active.
        // Previously we preferred highest totalTokens, which could make an
        // idle channel with more history shadow an active channel.
        const existingActive = isActiveBehavior(
          executionStateToBehavior(liveStates.get(existing.key), existing.aborted),
        );
        const sessActive = isActiveBehavior(sess.behavior);
        if (sessActive && !existingActive) {
          // Active always wins over idle.
          sessionMap.set(groupKey, sess);
        } else if (existingActive === sessActive) {
          // Same activity level — break tie by recency, then tokens.
          if ((sess.lastActivity ?? 0) > (existing.lastActivity ?? 0)
            || (sess.lastActivity === existing.lastActivity && sess.totalTokens > existing.totalTokens)) {
            sessionMap.set(groupKey, sess);
          }
        }
        // If existing is active and sess is idle, keep existing.
      }
    }
    const dedupedSessions = Array.from(sessionMap.values());

    const byKey = new Map<string, typeof dedupedSessions[0]>();
    const byId = new Map<string, typeof dedupedSessions[0]>();
    for (const sess of dedupedSessions) {
      byKey.set(sess.key, sess);
      byKey.set(canonicalSessionLookupKey(sess.key), sess);
      byId.set(sess.id, sess);
    }

    for (const sess of dedupedSessions) {
      const parentKey = inferParentSessionKey(sess.key);
      const parent = parentKey
        ? byKey.get(parentKey) ?? byKey.get(canonicalSessionLookupKey(parentKey))
        : null;
      if (parent) {
        sess.parentSessionId = parent.id;
        sess.parentSessionKey = parent.key;
        parent.childSessionIds = [...(parent.childSessionIds ?? []), sess.id];
      }
    }

    for (const sess of dedupedSessions) {
      let root = sess;
      let hops = 0;
      while (root.parentSessionId && hops < 8) {
        const parent = byId.get(root.parentSessionId);
        if (!parent) break;
        root = parent;
        hops++;
      }
      sess.rootSessionId = root.id;
    }

    return NextResponse.json({
      ok: true,
      timestamp: now,
      count: dedupedSessions.length,
      sessions: dedupedSessions,
    });
  } catch (err) {
    return NextResponse.json(
      { error: String(err), sessions: [] },
      { status: 502 },
    );
  }
}
