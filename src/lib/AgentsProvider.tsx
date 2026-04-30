// ============================================================================
// AgentsProvider — Shared React context for agent + office state across pages
// Prevents position resets when navigating between dashboard and office
// ============================================================================

'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { UseAgentsReturn } from '@/hooks/useAgents';
import type { UseOfficeReturn } from '@/hooks/useOffice';
import { useAgents } from '@/hooks/useAgents';
import { useOffice } from '@/hooks/useOffice';

interface SharedState {
  agents: UseAgentsReturn;
  office: UseOfficeReturn;
}

const SharedContext = createContext<SharedState | null>(null);

export function AgentsProvider({ children, demoMode }: { children: ReactNode; demoMode?: boolean }) {
  const agentsState = useAgents(demoMode);
  const officeState = useOffice(agentsState.agents, agentsState.agentStates);

  return (
    <SharedContext.Provider value={{ agents: agentsState, office: officeState }}>
      {children}
    </SharedContext.Provider>
  );
}

export function useSharedAgents(): UseAgentsReturn {
  const ctx = useContext(SharedContext);
  if (!ctx) throw new Error('useSharedAgents must be used within AgentsProvider');
  return ctx.agents;
}

export function useSharedOffice(): UseOfficeReturn {
  const ctx = useContext(SharedContext);
  if (!ctx) throw new Error('useSharedOffice must be used within AgentsProvider');
  return ctx.office;
}