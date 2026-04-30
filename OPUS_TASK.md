# Opus Task: Agent Monitor Dashboard — Live, Interactive, Rook-Native

## Repo
`C:\Users\Lahve\.openclaw\workspace\tmp\agent-monitor` (forked from ruiqili2/agent-monitor)
Fork: https://github.com/LukeWN420/agent-monitor
Currently running in dev mode: `npx next dev -p 3200`

## Context
This is a Next.js pixel-art agent dashboard for OpenClaw. It already has:
- 18 behavior states with pixel character animations
- Office view (canvas-based isometric office where agents walk around)
- Dashboard view (agent cards, activity feed, system stats)
- Meeting component (WebSocket chat connecting to OpenClaw gateway)
- Global boss chat (broadcasts to all agents)
- Autowork panel (trigger agent tasks from the UI)
- Agent registration API (POST /api/agents/register)
- CSRF middleware (allowed origins: localhost:3000, localhost:3001)

**Current problems:**
1. **SSR build bug**: `next build` fails — `/agents` page throws `window is not defined` during static generation. The page has `"use client"` but something accesses `window` at import time.
2. **Agents are static**: Once registered, agents don't update their behavior in real-time. The dashboard doesn't reflect what agents are actually doing.
3. **CSRF port mismatch**: Running on port 3200 but CSRF only allows 3000/3001.
4. **No voice**: Meeting/chat is text-only. No voice chat capability.
5. **No rich activity display**: Activity feed shows generic events, not what tools the agent is running, what code it's writing, or what it's thinking about.

## What We Want

### 1. Fix the SSR Build Bug (must-do)
- Find the component importing `window` at module scope (likely in a canvas or animation module)
- Either wrap in `typeof window !== 'undefined'` guard or use `next/dynamic` with `ssr: false`
- Ensure `npm run build` completes without errors
- Update `src/lib/csrf.ts` ALLOWED_ORIGINS to include `http://localhost:3200`

### 2. Live Agent State via WebSocket (core feature)
Right now, agent behavior is only set at registration. We need real-time state updates:

- When an OpenClaw agent session emits a chat event (delta/final/aborted), update the corresponding agent's behavior in the dashboard in real-time
- The `executionStateToBehavior()` function in `state-mapper.ts` already maps chatStatus → behavior. Wire it up.
- Use the existing gateway WebSocket connection (`ws://127.0.0.1:18789`) to subscribe to session events
- When a session's chatStatus changes, update the agent card AND the pixel character animation in the office view
- Show a "last activity" timestamp and a short description (e.g. "Running web_search", "Writing to process.py", "Idle — standing by")
- The existing `useAgentChat` hook connects to the gateway WebSocket. Extend this or create a parallel hook for state monitoring.

### 3. Rich Activity Feed (what agents are doing)
The activity feed currently shows generic demo events. Replace with real data:

- Parse gateway event data to extract tool calls (tool name, phase, input preview)
- Show tool execution as it happens: "♜ Rook → web_search('semantic kernel process framework')" with a running spinner
- Show completion: "✅ Rook → web_search completed (2.3s)"
- Show errors: "❌ Rook → exec failed: exit code 1"
- Group consecutive events by session/agent
- Add a "current task" indicator on each agent card showing the last tool call or activity

### 4. Agent Detail Panel (click an agent → see what they're doing)
When you click an agent card or pixel character:

- Show a slide-out panel with:
  - Current behavior + description
  - Last 20 events (tool calls, messages, state changes) as a live log
  - Token usage chart (already exists in components/agent/TokenUsage.tsx)
  - Task history (already exists in components/agent/TaskList.tsx)
  - A "Send Message" button to DM that agent via the gateway
  - A "Trigger Task" button (use the existing autowork mechanism)

### 5. Voice Chat in Meetings (stretch goal)
The meeting component already connects via WebSocket. Add voice:

- Add a "Join Voice" button to the meeting room
- Use the browser's Web Audio API to play ElevenLabs TTS audio streams
- The OpenClaw gateway already proxies audio — connect to the same WebSocket and render audio for messages tagged with audio URLs
- Add mute/unmute for the human user
- Show which agents are "speaking" (their pixel character gets a speech bubble)
- This can be a simple pass-through initially — no need for STT on the human side (they type in chat, the agent responds with voice)

### 6. Rook Branding (polish)
- Default agent color for Rook: #D4A843 (gold from our brand system)
- Default agent emoji: ♜
- Office theme: Deep Indigo (#0B1020) background, Gold (#D4A843) accents
- Add a ROOK-themed wallpaper option (can be a static image for now — we'll generate one with Gemini later)

## Integration Points

**State sync script** (already working): `C:\Users\Lahve\.openclaw\workspace\scripts\rook_state_sync.py`
- Pushes Rook's activity to both Agent Monitor (port 3200) and Star Office (port 19000)
- Activity mapping in ACTIVITY_MAP dict
- CSRF bypass: sends Origin: http://localhost:3000

**OpenClaw gateway**: `ws://127.0.0.1:18789`
- Subscribe to session events for live state
- Send messages to agents via the gateway
- The `useAgentChat` hook already has the connection logic

**Symphony orchestrator**: `C:\Users\Lahve\.openclaw\workspace\tmp\symphony-python`
- When a Symphony dispatch happens, the dashboard should show the agent moving to "working" state
- When dispatch completes, move to "idle" or "reporting"
- The Symphony dashboard (FastAPI, port 8765) could be embedded or linked from the agent detail panel

## Testing
- `npm run test` (vitest) — existing 92% coverage
- After SSR fix: `npm run build` must succeed
- Manual: start dev server, register an agent, verify live state updates in dashboard and office views

## Priority Order
1. SSR build fix + CSRF port fix (blocking)
2. Live agent state via WebSocket (core)
3. Rich activity feed (high value)
4. Agent detail panel (high value)
5. Rook branding (polish)
6. Voice chat (stretch)