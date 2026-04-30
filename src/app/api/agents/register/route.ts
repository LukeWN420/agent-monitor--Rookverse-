import { NextResponse } from 'next/server';

// Simple UUID generator (no dependencies)
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

interface RegisterRequest {
  agentName?: string;
  agentEmoji?: string;
  agentColor?: string;
  computerName?: string;
  ipAddress?: string;
  authToken?: string;
}

// Rook is the canonical default agent identity for this dashboard.
const DEFAULT_AGENT_NAME = 'Rook';
const DEFAULT_AGENT_EMOJI = '♜';
const DEFAULT_AGENT_COLOR = '#D4A843';
const DEFAULT_COMPUTER_NAME = 'LwN';

interface AgentRegistration {
  id: string;
  agentName: string;
  agentEmoji: string;
  agentColor: string;
  computerName: string;
  ipAddress: string;
  authToken: string;
  registeredAt: number;
  lastSeen: number;
  status: 'active' | 'inactive' | 'offline';
  capabilities: string[];
}

// In-memory store (should use database in production)
const registeredAgents = new Map<string, AgentRegistration>();

export async function POST(request: Request) {
  try {
    const body: RegisterRequest = await request.json();

    // Generate unique ID and auth token
    const agentId = `agent-${generateId()}`;
    const authToken = generateId();

    // Create registration. All fields default to Rook's brand identity if
    // the caller omits them, so a bare `POST /api/agents/register` with `{}`
    // produces a fully-formed Rook agent.
    const registration: AgentRegistration = {
      id: agentId,
      agentName: body.agentName || DEFAULT_AGENT_NAME,
      agentEmoji: body.agentEmoji || DEFAULT_AGENT_EMOJI,
      agentColor: body.agentColor || DEFAULT_AGENT_COLOR,
      computerName: body.computerName || DEFAULT_COMPUTER_NAME,
      ipAddress: body.ipAddress || 'unknown',
      authToken,
      registeredAt: Date.now(),
      lastSeen: Date.now(),
      status: 'active',
      capabilities: ['chat', 'tasks'],
    };
    
    // Store registration
    registeredAgents.set(agentId, registration);
    
    console.log(`[Agent Registration] New agent: ${registration.agentName} from ${registration.computerName}`);
    
    return NextResponse.json({
      ok: true,
      agentId,
      authToken,
      message: 'Agent registered successfully',
      registration: {
        id: agentId,
        agentName: registration.agentName,
        computerName: registration.computerName,
        status: registration.status,
      },
    });
  } catch (error) {
    console.error('[Agent Registration] Error:', error);
    return NextResponse.json(
      { error: 'Registration failed' },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const agents = Array.from(registeredAgents.values()).map(agent => ({
      id: agent.id,
      agentName: agent.agentName,
      agentEmoji: agent.agentEmoji,
      agentColor: agent.agentColor,
      computerName: agent.computerName,
      status: agent.status,
      lastSeen: agent.lastSeen,
      registeredAt: agent.registeredAt,
    }));
    
    return NextResponse.json({
      ok: true,
      count: agents.length,
      agents,
    });
  } catch (error) {
    console.error('[Agent List] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch agents' },
      { status: 500 }
    );
  }
}

// Heartbeat endpoint
export async function PUT(request: Request) {
  try {
    const { agentId, authToken } = await request.json();
    
    const agent = registeredAgents.get(agentId);
    if (!agent || agent.authToken !== authToken) {
      return NextResponse.json(
        { error: 'Invalid agent credentials' },
        { status: 401 }
      );
    }
    
    // Update last seen
    agent.lastSeen = Date.now();
    agent.status = 'active';
    registeredAgents.set(agentId, agent);
    
    return NextResponse.json({
      ok: true,
      message: 'Heartbeat received',
    });
  } catch (error) {
    console.error('[Heartbeat] Error:', error);
    return NextResponse.json(
      { error: 'Heartbeat failed' },
      { status: 500 }
    );
  }
}
