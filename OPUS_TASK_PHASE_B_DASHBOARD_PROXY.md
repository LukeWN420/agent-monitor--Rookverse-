# Phase B: Dashboard ↔ Symphony Proxy Routes

## Context
Phase A (async dispatch, 88/88 tests) is complete and verified via live smoke.
The Symphony FastAPI server runs on http://localhost:8765.
The Agent Monitor Next.js app runs on http://localhost:3200.
The dashboard currently shows agents from a static/hardcoded list. It needs to read from Symphony's live session registry.

## What to Build

### 1. Agent Monitor API Proxy Routes

Add Next.js API routes in `src/app/api/symphony/` that proxy to Symphony:

#### GET /api/symphony/sessions
- Proxies to `GET http://localhost:8765/sessions`
- Returns the full session registry (symphony_id, session_key, status, name, extra.persistent, etc.)
- The agents panel should render from this instead of the static list

#### POST /api/symphony/dispatch
- Proxies to `POST http://localhost:8765/sessions/dispatch`
- Forwards the request body: `{ prompt, name, persistent?, agent_id? }`
- Returns 202 + spawning info to the caller

#### POST /api/symphony/message
- Looks up the target agent's `session_key` from the Symphony registry (`GET /sessions`)
- If session_key is empty (still spawning), returns 202 `{ status: "pending", retry_after_ms: 1500 }`
- If session_key exists, sends the message via the gateway: `POST http://localhost:7413/api/gateway/action` with `{ action: "send", sessionKey, message }`
- NOTE: The gateway API port (7413) may not respond to health checks but the WS port (18789) works. The HTTP API should be available on the same port as the gateway's REST endpoint. If 7413 doesn't work, use the gateway's internal API.

### 2. Dashboard UI Updates

#### Agents Panel
- Replace static agent list with live data from `/api/symphony/sessions`
- Show status badges: spawning (yellow), working (green), error (red)
- Show session_key, agent_id, persistent flag
- Add "Dispatch New Agent" button that calls `/api/symphony/dispatch`

#### Meeting Room
- Map `symphony_id` → `session_key` from the registry
- When user sends a message to an agent in the meeting room, call `/api/symphony/message`
- Handle 202 pending responses with retry/backoff (existing logic in useSymphonyChat already does this)

### 3. Existing Code to Leverage
- `useSymphonyChat` hook already polls `/api/symphony/sessions` every 5s
- `useSymphonyChat.sendToSession` already retries on 202 with backoff
- `useAgents` provider can be extended to merge Symphony sessions with static agents
- The CSRF middleware already allows `localhost:8765` origins

### 4. Symphony Server URL
- Default: `http://localhost:8765`
- Should be configurable via env var: `SYMPHONY_DASHBOARD_URL`

## Verification
After implementation:
1. Open Agent Monitor dashboard → agents panel shows live Symphony sessions
2. Click "Dispatch" → new agent appears as "spawning" then transitions to "working"
3. Click on an agent in meeting room → can send messages and get replies
4. Persistent agents stay in the registry between messages
5. Error agents show red status with error details

## Files to Touch
- `src/app/api/symphony/sessions/route.ts` (new)
- `src/app/api/symphony/dispatch/route.ts` (new)
- `src/app/api/symphony/message/route.ts` (new)
- `src/hooks/useAgents.ts` (extend to merge Symphony data)
- `src/components/meeting/AgentMeeting.tsx` (wire up messaging)
- `src/lib/csrf.ts` (add localhost:8765 to allowed origins if not already)