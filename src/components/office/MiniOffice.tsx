// ============================================================================
// MiniOffice — Small office preview for the dashboard, with modal expand
// ============================================================================

'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import type { AgentConfig, AgentDashboardState, OwnerConfig, ThemeName } from '@/lib/types';
import { useSharedAgents, useSharedOffice } from '@/lib/AgentsProvider';
import OfficeCanvasInner from './OfficeCanvas';
import OfficeControls from '@/components/office/OfficeControls';
import ChatWindow from '@/components/chat/ChatWindow';

interface MiniOfficeProps {
  agents: AgentConfig[];
  agentStates: Record<string, AgentDashboardState>;
  ownerConfig: OwnerConfig;
  theme: ThemeName;
}

export default function MiniOffice({ agents, agentStates, ownerConfig, theme }: MiniOfficeProps) {
  const { officeState, tick } = useSharedOffice();
  const { demoMode, connected, chatMessages, sendChat, setBehavior, loadChatHistory } = useSharedAgents();
  const [expanded, setExpanded] = useState(false);
  const [chatAgent, setChatAgent] = useState<string | null>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  // Close on Escape key
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && expanded) setExpanded(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [expanded]);

  // Close on clicking backdrop (outside the canvas)
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === backdropRef.current) {
      setExpanded(false);
    }
  }, []);

  const openAgent = chatAgent ? agents.find((a) => a.id === chatAgent) : null;

  return (
    <>
      {/* Mini view — always visible */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-pixel text-sm flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <span>🏢</span>
            <span>Office</span>
          </h2>
          <button
            onClick={() => setExpanded(true)}
            className="text-xs font-mono px-2 py-1 rounded-md hover:bg-white/10 transition-colors cursor-pointer"
            style={{ color: 'var(--accent-primary)' }}
          >
            Full View →
          </button>
        </div>
        <div
          className="block group flex justify-center cursor-pointer"
          onClick={() => setExpanded(true)}
        >
          <div
            className="relative rounded-xl overflow-hidden transition-all duration-300 group-hover:ring-2"
            style={{ border: '1px solid var(--border)', maxWidth: 900 }}
          >
            <OfficeCanvasInner
              officeState={officeState}
              agents={agents}
              owner={ownerConfig}
              onTick={tick}
              width={1100}
              height={620}
              displayWidth={900}
              displayHeight={510}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end justify-center pb-4">
              <span className="text-xs font-mono px-3 py-1 rounded-full" style={{ backgroundColor: 'var(--accent-primary)', color: '#000' }}>
                Click to expand
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Expanded modal overlay — no page navigation, same React state */}
      {expanded && (
        <div
          ref={backdropRef}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center"
          style={{ backgroundColor: 'rgba(11, 16, 32, 0.85)' }}
          onClick={handleBackdropClick}
        >
          <div className="w-full max-w-7xl mx-auto px-4">
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-pixel text-sm flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <span>🏢</span>
                <span>Office — Full View</span>
              </h2>
              <button
                onClick={() => setExpanded(false)}
                className="text-sm font-mono px-3 py-1.5 rounded-lg hover:bg-white/10 transition-colors"
                style={{ color: 'var(--accent-primary)' }}
              >
                ✕ Close
              </button>
            </div>

            {/* Canvas */}
            <OfficeCanvasInner
              officeState={officeState}
              agents={agents}
              owner={ownerConfig}
              onTick={tick}
              width={1100}
              height={620}
            />

            {/* Controls */}
            <OfficeControls
              agents={agents}
              agentStates={agentStates}
              demoMode={demoMode}
              onSetBehavior={(id: string, b: any) => setBehavior(id, b)}
            />
          </div>

          {/* Chat window */}
          {openAgent && (
            <ChatWindow
              agentId={openAgent.id}
              agentName={openAgent.name}
              agentEmoji={openAgent.emoji}
              agentColor={openAgent.color}
              messages={chatMessages[openAgent.id] ?? []}
              onSend={sendChat}
              onClose={() => setChatAgent(null)}
              onOpen={() => loadChatHistory(openAgent.id)}
            />
          )}
        </div>
      )}
    </>
  );
}