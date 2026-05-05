// ============================================================================
// useSymphonyChat — Meeting-room state driven by Symphony's session registry
//
// Replaces the WS-only `useAgentChat`. Three responsibilities:
//
//   1. ROSTER  — poll `GET /api/symphony/sessions` to discover live persistent
//                sessions, refresh on a fixed cadence so newly-dispatched
//                agents appear in the meeting without a manual reload.
//   2. SEND    — `POST /api/symphony/message` with the target `symphony_id`.
//                Handles the 202 "pending" case (registry hasn't flushed
//                the dispatch yet) by retrying once after the suggested
//                back-off, then surfacing a visible failure if it still
//                isn't ready.
//   3. RECEIVE — poll `POST /api/gateway/action { action: 'history', ... }`
//                per-session and merge new entries into a unified message
//                stream. Diff-by-id so we don't double-append on overlap.
//
// Limitations called out for the next iteration:
// - Polling-based, not SSE. ~3s latency on roster + history. Trivially
//   replaced by tapping the existing `/api/gateway/events` stream when
//   we want real-time.
// - Optimistic-only for the user's own messages — if the gateway
//   eventually echoes them in `chat.history` we'll see a duplicate.
//   Mitigated by tagging optimistic ids with `local-` so we can
//   suppress later if needed.
// ============================================================================

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SymphonySession } from '@/lib/symphony';

const ROSTER_POLL_MS = 5_000;
const HISTORY_POLL_MS = 3_000;
const HISTORY_LIMIT = 20;
const MAX_MESSAGES = 200;
const PENDING_RETRY_MS_FALLBACK = 1_500;

export interface MeetingMessage {
  id: string;
  symphonyId: string | null;
  /** `user` for messages the human typed; otherwise the session's display name. */
  authorName: string;
  authorEmoji: string;
  /** `user` | `assistant` | `system` */
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

interface UseSymphonyChatOptions {
  isActive: boolean;
}

export interface UseSymphonyChatReturn {
  sessions: SymphonySession[];
  messages: MeetingMessage[];
  /** True after the first successful roster fetch. */
  isReady: boolean;
  /** Last roster fetch error, if any. */
  rosterError: string | null;
  startMeeting: () => void;
  endMeeting: () => void;
  /**
   * Send a message to one persistent session. Returns the server response;
   * caller can show "pending" UI when `status === 'pending'`.
   */
  sendToSession: (symphonyId: string, content: string) => Promise<SendResult>;
  /**
   * Broadcast a message to the team channel. Agents decide whether to respond.
   */
  sendToTeam: (content: string) => Promise<SendResult>;
  refreshRoster: () => Promise<void>;
}

export interface SendResult {
  ok: boolean;
  status?: 'pending' | 'sent' | 'error';
  retryAfterMs?: number;
  error?: string;
}

interface HistoryEntry {
  id?: string;
  role?: string;
  content?: string | object;
  text?: string | object;
  body?: string | object;
  message?: string | object;
  timestamp?: number;
  ts?: number;
}

function entryId(e: HistoryEntry, fallback: string): string {
  if (e.id) return e.id;
  return fallback;
}

function entryContent(e: HistoryEntry): string {
  const raw = e.content ?? e.text ?? e.body ?? e.message ?? '';
  // Gateway history returns content objects like {type: 'text', text: '...'}
  // instead of plain strings. Extract the text field if present.
  if (typeof raw === 'object' && raw !== null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const obj = raw as any;
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.content === 'string') return obj.content;
    // Last resort: stringify the object
    try { return JSON.stringify(obj); } catch { return '[object]'; }
  }
  return String(raw);
}

function entryTs(e: HistoryEntry): number {
  return e.ts ?? e.timestamp ?? Date.now();
}

export function useSymphonyChat({ isActive }: UseSymphonyChatOptions): UseSymphonyChatReturn {
  const [sessions, setSessions] = useState<SymphonySession[]>([]);
  const [messages, setMessages] = useState<MeetingMessage[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);

  // Per-session set of message ids we've already appended; lets the history
  // poll diff against new entries without rescanning everything.
  const seenBySessionRef = useRef<Map<string, Set<string>>>(new Map());
  const stopRef = useRef(false);

  const refreshRoster = useCallback(async () => {
    try {
      const res = await fetch('/api/symphony/sessions');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (Array.isArray(body.sessions)) {
        setSessions(body.sessions);
        setIsReady(true);
        setRosterError(null);
      }
    } catch (err) {
      setRosterError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // ---- Roster polling ------------------------------------------------------
  useEffect(() => {
    if (!isActive) {
      stopRef.current = true;
      return;
    }
    stopRef.current = false;
    refreshRoster();
    const t = setInterval(refreshRoster, ROSTER_POLL_MS);
    return () => {
      stopRef.current = true;
      clearInterval(t);
    };
  }, [isActive, refreshRoster]);

  // ---- History polling per session ----------------------------------------
  useEffect(() => {
    if (!isActive || sessions.length === 0) return;

    const fetchHistory = async () => {
      // Snapshot the session keys at tick start so a mid-tick roster change
      // doesn't fire calls for sessions we've already removed.
      const keys = sessions.map((s) => ({ symphonyId: s.symphony_id, sessionKey: s.session_key, name: s.name, emoji: s.emoji }));
      await Promise.all(keys.map(async (entry) => {
        if (!entry.sessionKey) return;
        try {
          const res = await fetch('/api/gateway/action', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              action: 'history',
              sessionKey: entry.sessionKey,
              limit: HISTORY_LIMIT,
            }),
          });
          if (!res.ok) return;
          const data = await res.json();
          const entries: HistoryEntry[] = Array.isArray(data?.result?.messages)
            ? data.result.messages
            : Array.isArray(data?.result)
              ? data.result
              : [];
          if (entries.length === 0) return;

          let seen = seenBySessionRef.current.get(entry.symphonyId);
          if (!seen) {
            seen = new Set();
            seenBySessionRef.current.set(entry.symphonyId, seen);
          }

          const fresh: MeetingMessage[] = [];
          for (let i = 0; i < entries.length; i++) {
            const raw = entries[i];
            // Skip user-role entries from history. The user's own messages
            // are optimistically appended at send time; pulling them back
            // from each session's history would (a) attribute the message
            // to the session's name+emoji instead of "You", and (b) emit
            // N duplicates per broadcast (one per recipient session). We
            // only render assistant + system entries here.
            if (raw.role === 'user') continue;
            const id = entryId(raw, `${entry.symphonyId}-${i}-${entryTs(raw)}`);
            if (seen.has(id)) continue;
            seen.add(id);
            const role: MeetingMessage['role'] =
              raw.role === 'system' ? 'system' : 'assistant';
            fresh.push({
              id,
              symphonyId: entry.symphonyId,
              authorName: entry.name,
              authorEmoji: entry.emoji || '♜',
              role,
              content: entryContent(raw),
              timestamp: entryTs(raw),
            });
          }

          if (fresh.length > 0) {
            setMessages((prev) => {
              const next = [...prev, ...fresh].slice(-MAX_MESSAGES);
              return next;
            });
          }
        } catch {
          // Silent — gateway or symphony being unreachable shouldn't crash UI.
        }
      }));
    };

    fetchHistory();
    const t = setInterval(fetchHistory, HISTORY_POLL_MS);
    return () => clearInterval(t);
  }, [isActive, sessions]);

  // ---- Public API ----------------------------------------------------------

  const startMeeting = useCallback(() => {
    seenBySessionRef.current.clear();
    setMessages([
      {
        id: `system-${Date.now()}`,
        symphonyId: null,
        authorName: 'System',
        authorEmoji: '♜',
        role: 'system',
        content: 'Meeting started. Roster live from Symphony.',
        timestamp: Date.now(),
      },
    ]);
    setIsReady(false);
    refreshRoster();
  }, [refreshRoster]);

  const endMeeting = useCallback(() => {
    setMessages([]);
    setSessions([]);
    seenBySessionRef.current.clear();
  }, []);

  const sendToSession = useCallback(
    async (symphonyId: string, content: string): Promise<SendResult> => {
      const trimmed = content.trim();
      if (!trimmed) return { ok: false, error: 'empty message' };

      // Optimistic-append so the user sees their message instantly.
      const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const optimistic: MeetingMessage = {
        id: localId,
        symphonyId,
        authorName: 'You',
        authorEmoji: '👤',
        role: 'user',
        content: trimmed,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, optimistic].slice(-MAX_MESSAGES));

      const post = async (): Promise<Response> =>
        fetch('/api/symphony/message', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ symphony_id: symphonyId, message: trimmed }),
        });

      try {
        let res = await post();
        if (res.status === 202) {
          // Registry hasn't flushed the dispatch yet — back off and retry once.
          const body = await res.json();
          const wait = typeof body.retry_after_ms === 'number' ? body.retry_after_ms : PENDING_RETRY_MS_FALLBACK;
          await new Promise((r) => setTimeout(r, wait));
          res = await post();
          if (res.status === 202) {
            return { ok: false, status: 'pending', retryAfterMs: wait, error: 'session not ready' };
          }
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          return { ok: false, status: 'error', error: body?.error || `HTTP ${res.status}` };
        }
        return { ok: true, status: 'sent' };
      } catch (err) {
        return {
          ok: false,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    [],
  );

  const sendToTeam = useCallback(async (content: string): Promise<SendResult> => {
    const trimmed = content.trim();
    if (!trimmed) return { ok: false, error: 'empty message' };

    // Optimistic append so the user sees their message instantly in the shared stream.
    const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: MeetingMessage = {
      id: localId,
      symphonyId: null,
      authorName: 'You',
      authorEmoji: '👤',
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, optimistic].slice(-MAX_MESSAGES));

    try {
      const res = await fetch('/api/symphony/broadcast', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: trimmed, channel: 'team-room' }),
      });
      if (res.status === 202) {
        const body = await res.json().catch(() => ({}));
        return { ok: false, status: 'pending', retryAfterMs: body?.retry_after_ms ?? PENDING_RETRY_MS_FALLBACK, error: body?.error || 'broadcast pending' };
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return { ok: false, status: 'error', error: body?.error || `HTTP ${res.status}` };
      }
      return { ok: true, status: 'sent' };
    } catch (err) {
      return { ok: false, status: 'error', error: err instanceof Error ? err.message : String(err) };
    }
  }, []);

  return useMemo(
    () => ({
      sessions,
      messages,
      isReady,
      rosterError,
      startMeeting,
      endMeeting,
      sendToSession,
      sendToTeam,
      refreshRoster,
    }),
    [sessions, messages, isReady, rosterError, startMeeting, endMeeting, sendToSession, sendToTeam, refreshRoster],
  );
}
