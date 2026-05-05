// ============================================================================
// POST /api/symphony/message
//
// 1. Look up the persistent session's `session_key` by `symphony_id` in the
//    Symphony registry (via `GET /sessions`).
// 2. Forward the message to the gateway via this app's existing
//    `/api/gateway/action { action: 'send', sessionKey, message }` route,
//    which already authenticates against OpenClaw via the persistent
//    `getGatewayConnection()` singleton.
//
// Async-dispatch caveat: Symphony's dispatch is synchronous in v0.2 (the
// runner blocks until `openclaw agent --json` returns), so the
// session_key is generally available immediately after dispatch. But if
// a caller fires `/api/symphony/message` for a `symphony_id` that hasn't
// been registered yet (race, or registry not flushed), we return **202
// Accepted** with `{ retry_after_ms }` so the client can back off and
// retry instead of receiving a hard 404.
// ============================================================================

import { NextResponse } from 'next/server';
import { fetchSessions, SymphonyError } from '@/lib/symphony';
import { getGatewayConnection, readOpenClawConfig } from '@/lib/gateway-connection';

export const dynamic = 'force-dynamic';

interface MessageBody {
  symphony_id?: string;
  /** Alias accepted in case callers used the API spec's camelCase. */
  symphonyId?: string;
  /**
   * Direct session_key bypass — if the caller already knows the key (for
   * example after a dispatch call's response), skip the registry lookup.
   */
  session_key?: string;
  sessionKey?: string;
  message?: string;
}

export async function POST(request: Request) {
  let body: MessageBody;
  try {
    body = (await request.json()) as MessageBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'invalid JSON body' },
      { status: 400 },
    );
  }

  const message = (body.message || '').trim();
  if (!message) {
    return NextResponse.json(
      { ok: false, error: 'message (non-empty string) is required' },
      { status: 400 },
    );
  }

  const symphonyId = body.symphony_id || body.symphonyId;
  let sessionKey = body.session_key || body.sessionKey || null;

  // If the caller supplied only the symphony_id, look up the session_key
  // from Symphony's registry. If neither is present, we can't proceed.
  if (!sessionKey) {
    if (!symphonyId) {
      return NextResponse.json(
        { ok: false, error: 'symphony_id or session_key is required' },
        { status: 400 },
      );
    }
    try {
      const list = await fetchSessions();
      const match = list.sessions.find((s) => s.symphony_id === symphonyId);
      if (!match || !match.session_key) {
        // Dispatch may not have flushed the registry yet — back-off-and-retry signal.
        return NextResponse.json(
          {
            ok: false,
            status: 'pending',
            error: 'session not yet available',
            symphony_id: symphonyId,
            retry_after_ms: 1500,
          },
          { status: 202 },
        );
      }
      sessionKey = match.session_key;
    } catch (err) {
      if (err instanceof SymphonyError) {
        return NextResponse.json(
          { ok: false, error: err.message, detail: err.detail },
          { status: 502 },
        );
      }
      return NextResponse.json(
        { ok: false, error: 'Symphony dashboard unreachable', detail: String(err) },
        { status: 502 },
      );
    }
  }

  // Now route through the gateway via the same path the rest of the
  // dashboard uses. Don't HTTP-call our own /api/gateway/action — that
  // round-trips through the Next.js handler for no benefit. Use the
  // shared connection singleton directly.
  const config = readOpenClawConfig();
  if (!config) {
    return NextResponse.json(
      { ok: false, error: 'OpenClaw config not found on this host' },
      { status: 500 },
    );
  }

  try {
    const gw = getGatewayConnection();
    const idempotencyKey = `sym-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const result = await gw.request('chat.send', {
      sessionKey,
      idempotencyKey,
      message,
    });
    return NextResponse.json({
      ok: true,
      symphony_id: symphonyId ?? null,
      session_key: sessionKey,
      result,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: 'gateway send failed',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }
}
