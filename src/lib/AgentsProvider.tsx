// ============================================================================
// AgentsProvider — Shared React context for agent state across pages
// Prevents position resets when navigating between dashboard and office
// ============================================================================

'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { UseAgentsReturn } from '@/hooks/useAgents';
import { useAgents } from '@/hooks/useAgents';

const AgentsContext = createContext<UseAgentsReturn | null>(null);

export function AgentsProvider({ children, demoMode }: { children: ReactNode; demoMode?: boolean }) {
  const agents = useAgents(demoMode);
  return (
    <AgentsContext.Provider value={agents}>
      {children}
    </AgentsContext.Provider>
  );
}

export function useSharedAgents(): UseAgentsReturn {
  const ctx = useContext(AgentsContext);
  if (!ctx) throw new Error('useSharedAgents must be used within AgentsProvider');
  return ctx;
}