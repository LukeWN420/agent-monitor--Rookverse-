# Code Review: Phase B & C — Agent Monitor

**Reviewer:** Rook
**Date:** 2026-05-06
**Scope:** Speech bubbles, per-agent identity, Symphony API routes

---

## 1. Speech Bubbles: Are They Real-Time or Do They Have Hidden Latency?

### Verdict: Bubbles are **near-real-time via SSE**, not truly real-time, and they have two distinct latency paths.

**How it actually works:**

1. **Gateway events → SSE → React state → canvas tick → bubble.** The `/api/gateway/events` SSE endpoint subscribes to `GatewayConnection` state changes and pushes `event: state` frames. The `useAgents` hook receives these and updates `agentStates`, which feeds into `useOffice`, which runs a canvas tick that decides whether to spawn a bubble.

2. **The SSE path is genuinely push-based.** The `GatewayConnection` singleton maintains a persistent WebSocket to the gateway and calls `notifySubscribers()` on every `chat`/`agent` event. The SSE endpoint subscribes to this. There's no polling on this path. This is good.

3. **But the meeting room (`useSymphonyChat`) is polling-based.** Roster refreshes every 5s (`ROSTER_POLL_MS = 5000`) and history every 3s (`HISTORY_POLL_MS = 3000`). Meeting-room messages are **not** real-time. They have 0–3s latency for agent replies and 0–5s for new agents appearing. The code comment even says: *"Polling-based, not SSE. ~3s latency on roster + history. Trivially replaced by tapping the existing `/api/gateway/events` stream when we want real-time."*

4. **Bubble spawning has a timing problem.** Bubbles trigger on two conditions in `useOffice.ts`:
   - **`justBecameActive`**: fires when `lastBehaviorSeen !== current behavior`. This is correct and fast — it catches behavior transitions.
   - **`cadenceFires`**: fires every ~900 ticks (staggered per agent). This means a long-running agent re-shows their bubble roughly every 900 canvas ticks. The actual time depends on tick rate.

5. **The real latency killer:** `useAgents` fetches full session metadata via `fetchSessions()` every 5 seconds, but the SSE stream only pushes state *deltas* (chatStatus, agentStatus, behavior). The `statusSummary` used in bubble text is computed from the SSE delta, so it's near-real-time. But if the SSE stream drops or the initial connect hasn't happened yet, the dashboard falls back to the 5s polling cycle, and bubble text shows stale data until the next poll.

6. **Bubble TTL creates visual latency even when data is fresh.** Transition bubbles get TTL 180, ambient bubbles TTL 120. At the default canvas tick rate, that's ~3-6 seconds of screen time. If an agent's status changes mid-bubble, the old bubble doesn't update — it just runs out its TTL, then the next tick may or may not spawn a new one. The user sees stale text for potentially seconds after the real state has changed.

### Specific Issues:

- **Bubble text is not live-updated.** Once a bubble is pushed onto the `bubbles[]` array with `text: bubbleText`, that text is frozen. The bubble's `ttl` decrements but its `text` never updates. If `statusSummary` changes while a bubble is still alive (e.g., agent goes from "Reading 3 files" to "Responding..."), the bubble continues showing "Reading 3 files" until TTL expires. This is a real gap — not hidden latency, but *stale latency*.

- **No streaming/delta support.** The `chatStatus === 'delta'` path is acknowledged (`dashState?.chatStatus === 'delta' ? 'Responding...' : null`) but there's no actual token streaming into the bubble. When the gateway sends `chatStatus: 'delta'`, the bubble just says "Responding..." statically — no progressive text reveal.

- **`useOffice` rebuilds `agentById` on every tick** via `agents.map((a, i) => ...)` inside the `setOfficeState` callback. This is O(n) per tick, which is fine for small n, but the map is recomputed every single canvas frame rather than being memoized or passed in as a ref.

---

## 2. Per-Agent Identity: Are Agents Sharing State?

### Verdict: **Mostly distinct, but with significant caveats around deduplication and Symphony overlay.**

**Where identity is genuinely per-agent:**

- **`sessionToAgentConfig()`** uses a hash-based deterministic slot system (`hashString(`${symId}|e`)`) to assign emoji/color/avatar to Symphony-managed agents. This means Wren consistently gets one set of visual identity, Mirren gets another, etc. This is well-designed.

- **Symphony overlay in `/api/gateway`** correctly pulls per-agent names and emoji from the Symphony session registry and applies them to explicit sessions. The comment about filtering `♜` (the default operator emoji) to avoid collapsing all Symphony agents to the same visual is smart.

- **Bubble emoji** is per-agent: `agentById[runtime.id]?.emoji ?? '♜'` pulls from the `AgentConfig` which has resolved per-agent identity.

**Where agents share state or collapse:**

1. **Session deduplication collapses same-agent channels.** `canonicalSessionLookupKey()` maps `agent:main:main` and `agent:main:discord:direct:7251...` to the same `agent:main` key. This is intentional — it means Rook-on-Discord and Rook-on-webchat are treated as one identity. But it means **if two channels have different status simultaneously** (e.g., Rook is actively responding on Discord but idle on webchat), the dedup keeps whichever session has more tokens, not whichever is more active. This can make an active agent appear idle.

2. **Fallback emoji is still `♜`.** When `symphonyOverlay.emoji === '♜'` (which is the Symphony default for every dispatch), the overlay is rejected and agents fall back to the hash-based slot system. This is correct. But if an agent doesn't have a Symphony overlay *and* isn't in the `agents` map from `agents.list`, they get `undefined` for emoji, which renders as the fallback `♜`. All non-Symphony, non-discovered agents look identical.

3. **The `useSymphonyChat` meeting room has its own identity resolution.** Meeting messages use `entry.name` and `entry.emoji` from the Symphony session, which are correct per-agent. But the history-polling path skips user-role messages to avoid duplicates, which means **the meeting room never shows what you sent from another session** — only what agents replied. This creates an asymmetric view where you see your optimistic local message, then see agent replies, but if you reload, your messages vanish.

4. **Office canvas agents share a single `agents` array in `useOffice`** with no isolation. The `tickFn` callback reads `agents` from closure, which is a React dependency. If `agents` changes (agent joins/leaves), the entire office state recomputes. There's no per-agent memoization. In practice this means **adding a new agent causes all existing agents to re-evaluate their positions and potentially reset their animation state**.

5. **Demo mode agents are hardcoded and state-isolated from real agents.** `DEMO_AGENTS` is a static array with no connection to real Symphony sessions. When switching from demo to live mode, all demo state (positions, animations, chat messages) is discarded. This is fine architecturally but means there's no smooth transition — it's a hard cut.

---

## 3. Security Issues in Symphony API Routes

### Verdict: **Several real issues, ranging from moderate to significant.**

### 3.1 CSRF Protection Has Gaps

The middleware validates `Origin`/`Referer` on all `/api/*` routes, which covers the Symphony endpoints. The allowed origins list (`localhost:3000`, `localhost:3001`, `localhost:3200`) is reasonable for dev. But:

- **No CSRF token mechanism.** `getCSRFToken()` returns a hardcoded `'dev-secret-token'` when `CSRF_SECRET` env var is unset. This function is never actually called in any route handler — it's defined but unused. The entire CSRF story is origin/referer checking, which is solid but not bulletproof (e.g., doesn't protect against same-origin attacks if the dashboard has an XSS vulnerability).

- **No authentication on any Symphony route.** `/api/symphony/dispatch`, `/api/symphony/message`, `/api/symphony/broadcast`, and `/api/symphony/sessions` all accept requests from any origin that passes CSRF (i.e., any page served from localhost:3000/3001/3200). There's no user auth, no API key, no session cookie check. Any JavaScript running on those origins can:
  - **Dispatch arbitrary agents** (`/dispatch` accepts any `prompt` and spawns an OpenClaw session)
  - **Send messages to any session** (`/message` routes to the gateway with full operator permissions)
  - **Broadcast to all sessions** (`/broadcast` sends to every registered session)

- **The broadcast route is particularly dangerous.** `POST /api/symphony/broadcast` sends a user-provided message to *every* registered session with no rate limiting, no authorization, and no confirmation step. An attacker who can run JS on localhost:3200 can spam all agents.

### 3.2 Input Validation Issues

- **`/api/symphony/dispatch`** accepts `prompt` (required) and optional fields like `workspace`, `thinking_level`, `turn_timeout_ms`. The `prompt` is passed directly to Symphony's `/sessions/dispatch` endpoint with no sanitization. If Symphony passes this to `openclaw agent` as a CLI argument, it could be vulnerable to command injection (depending on how Symphony handles it — this is outside the dashboard's control, but the dashboard doesn't sanitize at all).

- **`/api/symphony/message`** has a `session_key` bypass parameter. Callers can skip the Symphony registry lookup by providing `session_key` directly. This means if someone knows or guesses a session key, they can send messages to it without going through Symphony. Session keys follow predictable patterns (`agent:main:main`, `agent:main:explicit:sym-manual-...`) that are partially observable from the public `/api/gateway` GET endpoint.

- **No rate limiting on any endpoint.** A malicious or buggy client can flood `/dispatch` (spawning unlimited agents), `/message` (spamming sessions), or `/broadcast` (sending to all sessions repeatedly).

### 3.3 Information Exposure

- **`GET /api/symphony/sessions`** returns the full Symphony session registry including `session_key` for every session. This means any page that can reach localhost:8765 (or the Next.js proxy) can enumerate all active sessions and their keys. Combined with the `session_key` bypass in `/message`, this is a full privilege escalation path from "can read the session list" to "can send messages to any session."

- **`GET /api/gateway`** (the main session list endpoint) also returns session keys, model names, channels, token counts, and message previews. The `/api/gateway/events` SSE stream leaks real-time execution state including tool names and status summaries. While all of this is on localhost, the combination means a local attacker with browser access has full operational visibility.

### 3.4 Gateway Auth Is Stored Credentials

- The `gateway-connection.ts` reads `openclaw.json` from disk and extracts `token` and `password` in plaintext. The device identity private key is stored in `~/.openclaw/identity/device.json` and read on every auth. These are loaded into memory and stay in the `GatewayConnection` singleton for the lifetime of the process. This is standard for local tooling, but it means:
  - Any code running in the same Node process has access to gateway credentials
  - The private key is loaded from disk on every connection (not cached securely)
  - `chmod 0o600` is attempted but silently ignored on Windows (which doesn't support Unix permissions)

### 3.5 Race Condition in Message Route

- **`POST /api/symphony/message`** with `symphony_id` lookup: The code calls `fetchSessions()` (which hits Symphony's `/sessions` endpoint), then finds the matching session by `symphony_id`, then sends via the gateway. Between the lookup and the send, the session could be terminated. The 202 retry mechanism handles the "not yet registered" case but not the "was registered but now gone" case. In practice, `chat.send` to a dead session would fail gracefully, but the error path just returns a generic "gateway send failed" without distinguishing between "session doesn't exist" and "gateway is down."

### 3.6 Idempotency Keys Are Weak

- `idempotencyKey` in `/message` is `sym-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` and in `/broadcast` is `bc-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`. These provide minimal dedup protection — `Math.random()` is not cryptographically unique, and `Date.now()` has millisecond granularity. For a local-only tool this is acceptable, but if the dashboard were ever exposed to a network, collision probability becomes non-trivial under load.

---

## Summary

| Area | Status | Severity |
|------|--------|----------|
| Bubble real-time claim | Near-real-time via SSE, but stale text in bubbles, 3s polling in meeting room, no token streaming | Medium |
| Per-agent identity | Mostly distinct with good Symphony overlay, but dedup collapses channels, fallback identity is identical | Low-Medium |
| Symphony API security | No auth, no rate limiting, session_key bypass, full session enumeration, broadcast-to-all with no guardrails | **High** |
| CSRF | Origin-based only, no token mechanism, unused `getCSRFToken()` | Medium |
| Gateway credentials | In-memory, disk-read, Windows `chmod` silently ignored | Low (local-only context) |
| Race conditions | Session lookup → send race, no dead-session handling | Low |

### Recommendations (Priority Order):

1. ~~**Add authentication to Symphony routes.**~~ Deferred — local-only context, gateway auth handles the real connection. Will revisit if dashboard is ever exposed beyond localhost.
2. **✅ Rate-limit `/dispatch`, `/message`, and `/broadcast`.** Applied: dispatch 10/min, message 30/min, broadcast 3/min per IP. Uses `@/lib/rate-limit` with `clientIp()` helper.
3. **✅ Protect the `session_key` bypass in `/message`.** Now requires `X-Internal: true` header. External callers must use `symphony_id`. Tests updated.
4. **✅ Make bubble text mutable.** Already fixed in prior session — existing bubbles update text in-place when `statusSummary` changes. No stale-bubble latency.
5. **Switch meeting room history from polling to SSE.** Deferred — complex change, tapping `/api/gateway/events` is the right path but not needed before RuView.
6. **✅ Dedup prefers most-active, not most-tokens.** Already fixed in prior session — `isActiveBehavior` is the primary tiebreaker, then `lastActivity`, then `totalTokens`.
7. **✅ Remove unused `getCSRFToken()`.** Removed. Hardcoded `'dev-secret-token'` was never used — origin-based CSRF is the active protection.