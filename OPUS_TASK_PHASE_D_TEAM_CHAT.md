# Phase D: Shared Message Bus — Agent Team Chat

## Context
Phases A-C are complete:
- Phase A: Async dispatch, 88/88 tests, live smoke verified
- Phase B: Dashboard proxy routes + dispatch form in meeting room
- Phase C: Self-awareness loop with named agents (Pathfinder, Mirren, Vitalis)

The current meeting room (`AgentMeeting.tsx` + `useSymphonyChat.ts`) is a one-to-one chat:
user picks an agent from the roster, sends a message to that agent's session, gets a reply.
Lukey expected "team chat" to mean group conversation where all agents can see and respond.

## Problem
The current architecture routes messages to individual sessions via the gateway.
There is no shared channel where multiple agents receive the same message and
decide whether to respond. This means:
1. User must manually select which agent to talk to
2. Agents can't see what other agents are discussing
3. No way for agents to chime in organically based on relevance
4. No group conversation flow — it's DMs, not a team channel

## What to Build

### 1. Shared Message Bus (Symphony-side)

Add a WebSocket or SSE endpoint in Symphony that broadcasts messages to all
connected persistent sessions. When a message arrives in the team channel:

```
POST /api/symphony/broadcast
{
  "message": "Lukey's cortisol patterns are showing up in the sleep data",
  "from": "user",           // or agent symphony_id
  "channel": "team-room"    // named channel, extensible
}
```

All agents subscribed to "team-room" receive the message. Each agent's
session processes it and decides whether to respond based on relevance.

### 2. Relevance Filter (per-agent)

Each agent should have a role description that determines when it speaks.
This is NOT a hard routing rule — it's a prompt-level instruction:

- **Pathfinder**: Respond when topics involve research, web search, finding
  information, technology trends, or when asked directly. Stay silent on
  health, reflection, or community topics unless they intersect with research.

- **Mirren**: Respond when topics involve self-reflection, patterns, blind spots,
  growth, or when asked directly. Stay silent on research, health data, or
  community management unless they intersect with reflection.

- **Vitalis**: Respond when topics involve health, sleep, workouts, biometrics,
  Apple Health data, or when asked directly. Stay silent on research, reflection,
  or community topics unless they intersect with health.

- **Moltbook Ambassador**: Respond when topics involve community, Moltbook,
  social engagement, or when asked directly.

The key design principle: **silence is a valid response.** Agents should NOT
feel obligated to chime in on every message. Over-participation is the group
chat equivalent of the overproduction loop Mirren identified.

### 3. UI Changes (Agent Meeting → Team Chat)

The current `AgentMeeting.tsx` needs to evolve into a group chat:

**Left panel (Roster):**
- Show all connected agents with status badges
- Optional: click to "@" mention a specific agent
- Show "thinking..." indicator when an agent is processing

**Center panel (Messages):**
- Shared message stream, not per-agent
- User messages appear in gold/right-aligned
- Each agent's responses appear with their emoji and name
- System messages for agent joins/leaves/dispatches

**Right panel (optional, future):**
- Agent-specific detail: current task, last response, status

**Input:**
- Single text input for the team channel
- Optional "@Pathfinder" prefix to direct a message to a specific agent
- Without @ prefix, message goes to all agents (they decide whether to respond)

### 4. Turn-Taking Protocol

To prevent all agents responding simultaneously:

1. User sends message to team channel
2. Message is broadcast to all subscribed agents
3. Each agent evaluates relevance (prompt-level, not code-level)
4. Agents that decide to respond submit their replies
5. Replies are displayed in order received
6. Optional: if two agents are responding simultaneously, show a "X is typing..."
   indicator for the other

No hard turn-taking order. The relevance filter handles organically who responds.
If multiple agents respond, they see each other's messages and can build on them.

### 5. Dispatch Integration

The existing "Dispatch" button in the meeting room stays, but now dispatched
agents automatically join the team channel. The flow becomes:

1. Click "+ Dispatch" → enter prompt and name
2. Agent spawns, gets added to the team channel roster
3. Agent's initial response appears in the team chat
4. Agent remains in the channel for follow-up conversation

### 6. Technical Architecture

```
User ──POST /api/symphony/broadcast──► Symphony ──► All subscribed agents
                                          │
                                          ├─► Agent evaluates relevance
                                          │   ├─ Relevant → responds
                                          │   └─ Not relevant → silent
                                          │
                                          └─► Response posted to team channel
                                              via POST /api/symphony/message
                                              with channel="team-room"

Frontend ──GET /api/symphony/events──► SSE stream of all team messages
           (or poll GET /api/symphony/team-messages)
```

The existing `useSymphonyChat` hook evolves into `useTeamChat`:
- `sendMessage(text)` → broadcasts to team channel
- `sendDirect(symphonyId, text)` → DM to specific agent (current behavior)
- Messages stream shows all team messages, not just one agent's

### 7. Files to Modify/Create

- `symphony/dashboard.py` — add `/broadcast` and `/team-messages` endpoints
- `symphony/session_registry.py` — add channel subscription tracking
- `src/components/meeting/AgentMeeting.tsx` — evolve to team chat UI
- `src/components/meeting/useTeamChat.ts` — new hook (extends useSymphonyChat)
- `src/lib/symphony.ts` — add broadcast/team message types

### 8. Verification
1. Dispatch an agent via the UI → agent appears in roster
2. Send a message to the team channel → all agents receive it
3. Only relevant agents respond (Pathfinder on research, Vitalis on health, etc.)
4. Agents that don't respond stay silent (not "I don't have input on this")
5. User can @mention a specific agent for directed questions
6. Multiple agents can respond to the same message, building on each other
7. Dispatch form still works for adding new agents to the channel

## Design Philosophy
This is not a chatbot panel where every agent responds to everything.
It's a team room where agents have roles and choose when to contribute.
The silence-as-valid-response principle is critical — it prevents the
group chat equivalent of the overproduction loop.