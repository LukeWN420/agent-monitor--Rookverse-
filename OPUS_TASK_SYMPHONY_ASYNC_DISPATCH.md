# OPUS_TASK_SYMHPONY_ASYNC_DISPATCH.md

## Context
Phase A (PersistentSessionRunner + session registry + FastAPI dashboard) is code-complete and verified live on port 8765. We ran a smoke test and discovered the critical blocking issue below. Phase B (dashboard proxy routes) and Phase C (Rook self-awareness loop) are blocked until this is fixed.

## Smoke Test Results

**Working:**
- Symphony dashboard serves on http://127.0.0.1:8765
- `GET /sessions` returns `{ok: true, count: 0, sessions: []}`
- `POST /sessions/dispatch` accepts requests and calls PersistentSessionRunner
- `openclaw agent --agent main --message ... --json --thinking medium` successfully dispatches to the live gateway and the agent responds
- Session registry code (session_registry.py) is solid — atomic writes, proper schema, thread-safe

**Critical Bug — Blocking Dispatch:**
- `PersistentSessionRunner.run()` calls `subprocess.run()` which blocks until `openclaw agent` completes the full agent turn (2+ minutes)
- The FastAPI `/sessions/dispatch` endpoint blocks on this, so HTTP clients timeout (120s+)
- The registry entry is written AFTER `subprocess.run()` returns, so if the client times out, no session appears in `GET /sessions` — the dispatch vanishes silently
- **Result:** The dashboard can never show in-progress agents because they don't register until they're already done

## Required Fix: Async Dispatch with Pre-Registration

### What to change in `symphony/agent_runner.py` — `PersistentSessionRunner.run()`

1. **Pre-register** the session in the registry BEFORE spawning the subprocess, with `status: "spawning"`. This ensures `GET /sessions` shows the agent immediately.

2. **Spawn the subprocess in a background thread** (or use `subprocess.Popen` + return immediately). The FastAPI endpoint should return a 202 Accepted with the `symphony_id` as soon as the pre-registration is done, not wait for the agent turn to complete.

3. **On thread completion**, update the registry entry:
   - If subprocess exited 0: set `status: "working"`, write `session_key` from stdout
   - If subprocess failed: set `status: "error"`, write error details
   - If timeout: set `status: "error"`, write timeout message

4. **Handle crashes**: wrap the background thread in try/except; if the thread dies, mark the entry as `error`

### What to change in `symphony/dashboard.py` — `dispatch_session()`

- The endpoint should return **202 Accepted** (not 200) once the pre-registration succeeds
- Response body should include `{ok: true, symphony_id: "...", status: "spawning"}` immediately
- The actual agent result will be available later via `GET /sessions/{symphony_id}`

### Session status flow after fix:
```
spawning → working (subprocess exited 0, session_key captured)
spawning → error (subprocess failed or timed out)
working → idle (mark via POST /sessions/{id}/status)
working → error (mark if agent becomes unreachable)
any → dead (mark via purge or manual)
```

### Additional fix: `openclaw agent --json` output parsing
The `_extract_session_key` method in `OpenClawSessionRunner` needs to handle the REAL output shape from `openclaw agent --json`. We confirmed the CLI works but didn't capture its JSON output shape (the subprocess was killed before completion). After the async fix lands, capture one real `--json` response and verify the extractor handles it. If the real shape differs from what the regex patterns expect, adjust accordingly.

## Verification Steps

After the fix:
1. `curl -X POST http://127.0.0.1:8765/sessions/dispatch -H 'content-type: application/json' -d '{"prompt":"smoke test: say hello","name":"Test-Async","task":"smoke"}'`
   - Should return **202** immediately with `{"ok": true, "symphony_id": "...", "status": "spawning"}`
2. `curl http://127.0.0.1:8765/sessions` — should show the agent with status "spawning"
3. Wait 2-3 minutes, then `curl http://127.0.0.1:8765/sessions` — should show status "working" or "idle" with a real `session_key`
4. Verify `_extract_session_key` captured the real session_key from `--json` output

## Do NOT do (yet)
- Do NOT build Phase B dashboard proxy routes (blocked on this fix)
- Do NOT build Phase C self-awareness loop
- Do NOT change the `/sessions` route shape or registry schema
- Do NOT add SSE polling or de-dup logic (conditional, wait for smoke)

## Estimated Time
~45-60 min for async dispatch + pre-registration + verification