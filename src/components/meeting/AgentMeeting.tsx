// ============================================================================
// AgentMeeting — multi-agent meeting room driven by Symphony's session registry
//
// Replaces the v0 WS-only scaffold. Roster live from `/api/symphony/sessions`,
// messages routed via `/api/symphony/message` (which authenticates against
// the OpenClaw gateway), incoming replies polled per-session via the
// existing `/api/gateway/action { action: 'history' }` route.
// ============================================================================

'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSymphonyChat, type MeetingMessage } from './useSymphonyChat';
import type { SymphonySession } from '@/lib/symphony';

interface AgentMeetingProps {
  // Kept for backwards compatibility with the dashboard page that still
  // passes `agents={agents}`. Unused — the live roster comes from Symphony.
  agents?: unknown[];
}

function statusColor(status: string): string {
  switch (status) {
    case 'working':
      return '#FFCA28';
    case 'idle':
      return '#D4A843';
    case 'error':
      return '#EF5350';
    case 'dead':
      return '#78909C';
    default:
      return '#AB47BC';
  }
}

function MessageRow({ msg }: { msg: MeetingMessage }) {
  const isUser = msg.role === 'user';
  const isSystem = msg.role === 'system';
  return (
    <div className={`flex items-start gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
      <span className="text-lg flex-shrink-0">{msg.authorEmoji}</span>
      <div className={`flex-1 min-w-0 ${isUser ? 'text-right' : ''}`}>
        <div className="flex items-center gap-2 mb-1" style={{ justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
          <span className="text-xs font-mono" style={{ color: 'var(--text-primary)' }}>
            {msg.authorName}
          </span>
          <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
            {new Date(msg.timestamp).toLocaleTimeString()}
          </span>
        </div>
        <p
          className="text-sm inline-block px-3 py-2 rounded-lg whitespace-pre-wrap break-words"
          style={{
            backgroundColor: isSystem
              ? 'transparent'
              : isUser
                ? 'rgba(212, 168, 67, 0.12)'
                : 'var(--bg-card)',
            color: 'var(--text-primary)',
            border: isSystem ? '1px dashed var(--border)' : '1px solid var(--border)',
            maxWidth: '85%',
            textAlign: 'left',
          }}
        >
          {msg.content}
        </p>
      </div>
    </div>
  );
}

function RosterRow({
  session,
  selected,
  onClick,
}: {
  session: SymphonySession;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-2 py-1.5 rounded-md transition-colors"
      style={{
        backgroundColor: selected ? 'rgba(212, 168, 67, 0.15)' : 'transparent',
        border: `1px solid ${selected ? '#D4A843' : 'var(--border)'}`,
      }}
    >
      <div className="flex items-center gap-2">
        <span>{session.emoji || '♜'}</span>
        <span className="text-xs font-mono flex-1 truncate" style={{ color: 'var(--text-primary)' }}>
          {session.name}
        </span>
        <span
          className="text-[9px] font-mono px-1.5 py-0.5 rounded"
          style={{
            color: statusColor(session.status),
            backgroundColor: `${statusColor(session.status)}20`,
          }}
        >
          {session.status}
        </span>
      </div>
      {session.task && (
        <div
          className="text-[10px] truncate mt-0.5"
          style={{ color: 'var(--text-secondary)' }}
        >
          {session.task}
        </div>
      )}
    </button>
  );
}

export default function AgentMeeting(_props: AgentMeetingProps) {
  const [isMeetingActive, setIsMeetingActive] = useState(false);
  const [inputMessage, setInputMessage] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [pendingTarget, setPendingTarget] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [isDispatchOpen, setIsDispatchOpen] = useState(false);
  const [dispatchPrompt, setDispatchPrompt] = useState('');
  const [dispatchName, setDispatchName] = useState('');
  const [dispatchPersistent, setDispatchPersistent] = useState(true);
  const [dispatchBusy, setDispatchBusy] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    sessions,
    messages,
    isReady,
    rosterError,
    startMeeting,
    endMeeting,
    sendToSession,
    sendToTeam,
    refreshRoster,
  } = useSymphonyChat({ isActive: isMeetingActive });

  // Auto-scroll on new messages.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Default-select the first session once the roster lands; if it goes
  // away, drop the selection so we never send into a void.
  useEffect(() => {
    if (!targetId && sessions.length > 0) {
      setTargetId(sessions[0].symphony_id);
    }
    if (targetId && !sessions.some((s) => s.symphony_id === targetId)) {
      setTargetId(sessions[0]?.symphony_id ?? null);
    }
  }, [sessions, targetId]);

  const handleStart = useCallback(() => {
    setIsMeetingActive(true);
    startMeeting();
  }, [startMeeting]);

  const handleEnd = useCallback(() => {
    setIsMeetingActive(false);
    endMeeting();
    setTargetId(null);
    setSendError(null);
    setPendingTarget(null);
  }, [endMeeting]);

  const handleSend = useCallback(async () => {
    const text = inputMessage.trim();
    if (!text) return;
    setSendError(null);
    setPendingTarget(null);
    setInputMessage('');

    // Detect directed messages like "@Pathfinder do X". If an @mention matches
    // a session name, send directly to that session. Otherwise broadcast to
    // the team channel so agents decide whether to respond.
    const m = text.match(/^@([\w-]+)\b\s*(.*)/);
    if (m) {
      const targetName = m[1];
      const remainder = m[2] || '';
      const found = sessions.find((s) => s.name?.toLowerCase() === targetName.toLowerCase() || s.agent_id === targetName);
      if (found) {
        const result = await sendToSession(found.symphony_id, remainder || text);
        if (!result.ok) {
          if (result.status === 'pending') {
            setPendingTarget(found.symphony_id);
            setSendError('Session is still spawning — try again in a moment.');
          } else {
            setSendError(result.error || 'send failed');
          }
        }
        return;
      }
      // If mention didn't match, fall through to team broadcast.
    }

    const result = await sendToTeam(text);
    if (!result.ok) {
      if (result.status === 'pending') {
        setSendError('Broadcast pending — try again in a moment.');
      } else {
        setSendError(result.error || 'broadcast failed');
      }
    }
  }, [inputMessage, targetId, sendToSession, sendToTeam, sessions]);

  const handleDispatch = useCallback(async () => {
    const prompt = dispatchPrompt.trim();
    if (!prompt || dispatchBusy) return;
    setDispatchBusy(true);
    setDispatchError(null);
    try {
      const res = await fetch('/api/symphony/dispatch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt,
          name: dispatchName.trim() || undefined,
          persistent: dispatchPersistent,
        }),
      });
      const body = await res.json().catch(() => ({}));
      // Symphony returns 202 (accepted, async) on the happy path; 200 on
      // synchronous failure (missing binary, pre-register error). Treat
      // anything in 2xx as success.
      if (!res.ok) {
        setDispatchError(body?.error || `HTTP ${res.status}`);
        return;
      }
      // Re-pull the roster so the spawning placeholder appears, and
      // auto-select the new agent so the user can message it as soon
      // as the session_key resolves.
      await refreshRoster();
      if (typeof body.symphony_id === 'string') {
        setTargetId(body.symphony_id);
      }
      setDispatchPrompt('');
      setDispatchName('');
      setIsDispatchOpen(false);
    } catch (err) {
      setDispatchError(err instanceof Error ? err.message : String(err));
    } finally {
      setDispatchBusy(false);
    }
  }, [dispatchPrompt, dispatchName, dispatchPersistent, dispatchBusy, refreshRoster]);

  // ----- Pre-meeting view --------------------------------------------------
  if (!isMeetingActive) {
    return (
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-pixel text-lg" style={{ color: 'var(--text-primary)' }}>
            ♜ Meeting Room
          </h2>
          <button
            onClick={handleStart}
            className="px-4 py-2 rounded-lg font-mono text-sm hover:opacity-90"
            style={{ backgroundColor: 'var(--accent-primary)', color: '#000' }}
          >
            Start Meeting
          </button>
        </div>
        <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>
          Multi-agent meetings, live from Symphony's session registry. Roster
          updates every 5s; messages route through the OpenClaw gateway.
        </p>
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          Dispatch persistent agents via <code className="px-1 rounded bg-[var(--bg-secondary)]">POST /api/symphony/dispatch</code> to
          populate the roster.
        </p>
      </div>
    );
  }

  // ----- Active meeting view -----------------------------------------------
  const targetSession = targetId ? sessions.find((s) => s.symphony_id === targetId) : null;

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-pixel text-lg flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          ♜ Meeting Room
          <span
            className="text-xs font-mono px-2 py-0.5 rounded-full"
            style={{
              color: isReady ? '#D4A843' : 'var(--text-secondary)',
              backgroundColor: isReady ? 'rgba(212,168,67,0.12)' : 'var(--bg-secondary)',
            }}
          >
            {isReady ? `${sessions.length} agent${sessions.length === 1 ? '' : 's'}` : 'connecting...'}
          </span>
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsDispatchOpen((v) => !v)}
            className="px-3 py-1.5 rounded-lg text-xs font-mono"
            style={{
              backgroundColor: isDispatchOpen ? 'rgba(212,168,67,0.15)' : 'var(--bg-secondary)',
              color: isDispatchOpen ? '#D4A843' : 'var(--text-secondary)',
              border: `1px solid ${isDispatchOpen ? '#D4A843' : 'var(--border)'}`,
            }}
            title="Dispatch a new agent"
          >
            {isDispatchOpen ? '× Cancel' : '+ Dispatch'}
          </button>
          <button
            onClick={refreshRoster}
            className="px-3 py-1.5 rounded-lg text-xs font-mono"
            style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}
            title="Refresh roster"
          >
            ↻
          </button>
          <button
            onClick={handleEnd}
            className="px-3 py-1.5 rounded-lg text-sm font-mono"
            style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}
          >
            End
          </button>
        </div>
      </div>

      {isDispatchOpen && (
        <div
          className="mb-3 p-3 rounded-lg space-y-2"
          style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
        >
          <p
            className="text-[10px] font-mono uppercase tracking-wider"
            style={{ color: 'var(--text-secondary)' }}
          >
            Dispatch new agent
          </p>
          <textarea
            value={dispatchPrompt}
            onChange={(e) => setDispatchPrompt(e.target.value)}
            placeholder="Initial prompt for the agent..."
            rows={3}
            className="w-full px-3 py-2 rounded-lg text-sm font-mono focus:outline-none"
            style={{
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
              resize: 'vertical',
            }}
          />
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={dispatchName}
              onChange={(e) => setDispatchName(e.target.value)}
              placeholder="Display name (optional)"
              className="flex-1 px-3 py-1.5 rounded-lg text-sm focus:outline-none"
              style={{
                backgroundColor: 'var(--bg-card)',
                border: '1px solid var(--border)',
                color: 'var(--text-primary)',
              }}
            />
            <label
              className="flex items-center gap-1.5 text-xs font-mono select-none"
              style={{ color: 'var(--text-secondary)' }}
            >
              <input
                type="checkbox"
                checked={dispatchPersistent}
                onChange={(e) => setDispatchPersistent(e.target.checked)}
              />
              persistent
            </label>
            <button
              onClick={handleDispatch}
              disabled={!dispatchPrompt.trim() || dispatchBusy}
              className="px-4 py-1.5 rounded-lg font-mono text-sm hover:opacity-90 disabled:opacity-40"
              style={{ backgroundColor: 'var(--accent-primary)', color: '#000' }}
            >
              {dispatchBusy ? 'Dispatching...' : 'Dispatch'}
            </button>
          </div>
          {dispatchError && (
            <p
              className="text-xs font-mono"
              style={{ color: 'var(--accent-danger)' }}
            >
              {dispatchError}
            </p>
          )}
        </div>
      )}

      {rosterError && (
        <div
          className="mb-3 p-2 rounded-lg text-xs font-mono"
          style={{ color: 'var(--accent-danger)', backgroundColor: 'rgba(239,83,80,0.1)' }}
        >
          Symphony unreachable: {rosterError}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Roster */}
        <div className="space-y-1.5 max-h-96 overflow-y-auto">
          <p
            className="text-[10px] font-mono uppercase tracking-wider px-1"
            style={{ color: 'var(--text-secondary)' }}
          >
            Roster
          </p>
          {sessions.length === 0 ? (
            <p className="text-xs px-1" style={{ color: 'var(--text-secondary)' }}>
              {isReady ? 'No active sessions yet — dispatch one to begin.' : 'Loading...'}
            </p>
          ) : (
            sessions.map((s) => (
              <RosterRow
                key={s.symphony_id}
                session={s}
                selected={s.symphony_id === targetId}
                onClick={() => setTargetId(s.symphony_id)}
              />
            ))
          )}
        </div>

        {/* Messages + input */}
        <div className="md:col-span-2 flex flex-col">
          <div
            className="flex-1 mb-3 p-3 rounded-lg space-y-3 overflow-y-auto"
            style={{
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              minHeight: 320,
              maxHeight: 384,
            }}
          >
            {messages.length === 0 ? (
              <p className="text-center text-sm py-12" style={{ color: 'var(--text-secondary)' }}>
                Pick an agent and say something.
              </p>
            ) : (
              messages.map((m) => <MessageRow key={m.id} msg={m} />)
            )}
            <div ref={messagesEndRef} />
          </div>

          {sendError && (
            <div
              className="mb-2 p-2 rounded-lg text-xs font-mono"
              style={{
                color: pendingTarget ? 'var(--accent-warning)' : 'var(--accent-danger)',
                backgroundColor: pendingTarget
                  ? 'rgba(255,202,40,0.1)'
                  : 'rgba(239,83,80,0.1)',
              }}
            >
              {sendError}
            </div>
          )}

          <div className="flex gap-2">
            <input
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={
                targetSession
                  ? `Message ${targetSession.name}...`
                  : 'Message team (use @Name to direct)...'
              }
              disabled={!isReady}
              className="flex-1 px-4 py-2 rounded-lg text-sm focus:outline-none disabled:opacity-50"
              style={{
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                color: 'var(--text-primary)',
              }}
            />
            <button
              onClick={handleSend}
              disabled={!inputMessage.trim() || !isReady}
              className="px-4 py-2 rounded-lg font-mono text-sm hover:opacity-90 disabled:opacity-40"
              style={{ backgroundColor: 'var(--accent-primary)', color: '#000' }}
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
