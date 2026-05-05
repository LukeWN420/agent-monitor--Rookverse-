// ============================================================================
// POST /api/symphony/broadcast
//
// Broadcasts a message to all persistent sessions registered with Symphony.
// Each session receives the message and decides (prompt-level) whether to
// respond. Optional `channel` may be supplied for future channel filtering.
// ============================================================================

import { NextResponse } from 'next/server';
import { fetchSessions, SymphonyError } from '@/lib/symphony';
import { getGatewayConnection, readOpenClawConfig } from '@/lib/gateway-connection';

export const dynamic = 'force-dynamic';

interface Body {
  message?: string;
  channel?: string;
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }

  const message = (body.message || '').trim();
  if (!message) {
    return NextResponse.json({ ok: false, error: 'message (non-empty string) is required' }, { status: 400 });
  }

  // For now we broadcast to all sessions that expose a session_key. In the
  // future we can filter by `channel` via session.extra metadata.
  let sessions;
  try {
    const list = await fetchSessions();
    sessions = Array.isArray(list.sessions) ? list.sessions.filter((s) => s.session_key) : [];
  } catch (err) {
    if (err instanceof SymphonyError) {
      return NextResponse.json({ ok: false, error: err.message, detail: err.detail }, { status: 502 });
    }
    return NextResponse.json({ ok: false, error: 'Symphony dashboard unreachable', detail: String(err) }, { status: 502 });
  }

  if (sessions.length === 0) {
    return NextResponse.json({ ok: false, error: 'no sessions available to broadcast to' }, { status: 400 });
  }

  const config = readOpenClawConfig();
  if (!config) {
    return NextResponse.json({ ok: false, error: 'OpenClaw config not found on this host' }, { status: 500 });
  }

  try {
    const gw = getGatewayConnection();
    const results = await Promise.allSettled(
      sessions.map((s, i) =>
        gw.request('chat.send', {
          sessionKey: s.session_key,
          idempotencyKey: `bc-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`,
          message,
        }),
      ),
    );

    const delivered = results
      .map((r, i) => ({ r, session: sessions[i] }))
      .filter((e) => e.r.status === 'fulfilled')
      .map((e) => ({ session_key: e.session.session_key, symphony_id: e.session.symphony_id, result: (e.r as PromiseFulfilledResult<unknown>).value }));

    const failed = results
      .map((r, i) => ({ r, session: sessions[i] }))
      .filter((e) => e.r.status === 'rejected')
      .map((e) => ({ session_key: e.session.session_key, symphony_id: e.session.symphony_id, error: (e.r as PromiseRejectedResult).reason instanceof Error ? (e.r as PromiseRejectedResult).reason.message : String((e.r as PromiseRejectedResult).reason) }));

    return NextResponse.json({ ok: failed.length === 0, delivered, failed });
  } catch (err) {
    return NextResponse.json({ ok: false, error: 'gateway broadcast failed', detail: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}

