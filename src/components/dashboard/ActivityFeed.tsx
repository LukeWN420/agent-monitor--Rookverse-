// ============================================================================
// ActivityFeed — Real-time activity event list
// ============================================================================

'use client';

import { useEffect, useMemo, useRef } from 'react';
import DOMPurify from 'dompurify';
import type { ActivityEvent } from '@/lib/types';
import { formatRelativeTime } from '@/lib/state-mapper';

interface ActivityFeedProps {
  events: ActivityEvent[];
  maxHeight?: number;
}

interface RenderedEvent {
  event: ActivityEvent;
  icon: string;
  color: string;
  message: string;
  spinning?: boolean;
}

interface EventGroup {
  agentId: string;
  agentName: string;
  agentEmoji: string;
  items: RenderedEvent[];
}

// Static (non-tool) event icon/color mapping. Tool events are rendered via
// renderToolEvent below because they need phase-aware formatting.
const STATIC_STYLES: Record<string, { icon: string; color: string }> = {
  state_change: { icon: '🔄', color: '#4FC3F7' },
  task_start:   { icon: '▶️', color: '#66BB6A' },
  task_complete: { icon: '✅', color: '#66BB6A' },
  task_fail:    { icon: '❌', color: '#EF5350' },
  message:      { icon: '💬', color: '#AB47BC' },
  error:        { icon: '🚨', color: '#EF5350' },
  system:       { icon: '🖥️', color: '#78909C' },
};

function formatDuration(ms: number | undefined): string {
  if (!ms || ms < 0) return '';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function renderToolEvent(event: ActivityEvent, agentEmoji: string, agentName: string): RenderedEvent {
  // Backwards compat: events without an explicit phase get rendered as
  // "start" so older serialized feeds keep working.
  const phase = event.phase ?? 'start';
  const tool = event.toolName ?? event.message;
  const toolPhase = event.toolPhase ? `(${event.toolPhase})` : '';

  if (phase === 'start') {
    return {
      event,
      icon: '⏳',
      color: '#FFCA28',
      message: `${agentEmoji} ${agentName} → ${tool}${toolPhase ? ` ${toolPhase}` : ''}`,
      spinning: true,
    };
  }

  if (phase === 'complete') {
    const dur = formatDuration(event.durationMs);
    return {
      event,
      icon: '✅',
      color: '#66BB6A',
      message: `${tool} completed${dur ? ` (${dur})` : ''}`,
    };
  }

  // fail
  const reason = event.errorReason ?? event.message ?? 'unknown error';
  return {
    event,
    icon: '❌',
    color: '#EF5350',
    message: `${tool} failed: ${reason}`,
  };
}

function renderEvent(event: ActivityEvent): RenderedEvent {
  if (event.type === 'tool_call') {
    return renderToolEvent(event, event.agentEmoji, event.agentName);
  }
  const style = STATIC_STYLES[event.type] ?? STATIC_STYLES.system;
  return { event, icon: style.icon, color: style.color, message: event.message };
}

/**
 * Collapse consecutive events from the same agent into one group so the
 * feed reads as a per-agent timeline rather than a wall of identical
 * "♜ Rook" labels.
 */
function groupConsecutive(events: ActivityEvent[]): EventGroup[] {
  const groups: EventGroup[] = [];
  for (const event of events) {
    const rendered = renderEvent(event);
    const last = groups[groups.length - 1];
    if (last && last.agentId === event.agentId) {
      last.items.push(rendered);
    } else {
      groups.push({
        agentId: event.agentId,
        agentName: event.agentName,
        agentEmoji: event.agentEmoji,
        items: [rendered],
      });
    }
  }
  return groups;
}

export default function ActivityFeed({ events, maxHeight = 400 }: ActivityFeedProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  useEffect(() => {
    if (scrollRef.current && isAtBottomRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [events.length]);

  const groups = useMemo(() => groupConsecutive(events), [events]);

  return (
    <div>
      <h2 className="font-pixel text-sm mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
        <span>📡</span>
        <span>Activity Feed</span>
      </h2>
      <div
        ref={scrollRef}
        className="rounded-xl overflow-y-auto p-3 space-y-2"
        style={{
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border)',
          maxHeight,
        }}
        onScroll={() => {
          if (scrollRef.current) {
            isAtBottomRef.current = scrollRef.current.scrollTop < 10;
          }
        }}
      >
        {groups.length === 0 && (
          <div className="text-center py-8">
            <span className="text-2xl block mb-2">📡</span>
            <p className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
              Waiting for events...
            </p>
          </div>
        )}
        {groups.map((group, gi) => (
          <div key={`${group.agentId}-${gi}-${group.items[0]?.event.id ?? gi}`}>
            <div className="text-[10px] font-mono font-bold mb-1 px-2"
                 style={{ color: 'var(--text-secondary)' }}>
              {group.agentEmoji} {group.agentName}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <div
                  key={item.event.id}
                  className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5 transition-colors"
                >
                  <span
                    className={`text-xs flex-shrink-0 mt-0.5${item.spinning ? ' animate-pulse' : ''}`}
                  >
                    {item.icon}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs truncate" style={{ color: item.color }}>
                      {DOMPurify.sanitize(item.message)}
                    </p>
                    <span className="text-[9px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                      {formatRelativeTime(item.event.timestamp)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
