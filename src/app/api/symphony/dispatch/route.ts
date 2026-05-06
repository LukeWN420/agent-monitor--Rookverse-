// ============================================================================
// POST /api/symphony/dispatch
//
// Forwards to Symphony's `/sessions/dispatch` endpoint. Symphony spawns a
// persistent OpenClaw session via the `openclaw agent` CLI (which handles
// auth) and registers it in the session registry.
//
// Request body matches `SymphonyDispatchBody`. `prompt` is required; the
// rest are optional with sensible defaults handled Symphony-side.
// ============================================================================

import { NextResponse } from 'next/server';
import { dispatchSession, SymphonyError, type SymphonyDispatchBody } from '@/lib/symphony';
import { checkRateLimit, clientIp } from '@/lib/rate-limit';

/** Rate limit: 10 dispatches per minute per client. */
const DISPATCH_LIMIT = 10;
const DISPATCH_WINDOW = 60_000;

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const ip = clientIp(request);
  const rl = checkRateLimit(`dispatch:${ip}`, DISPATCH_LIMIT, DISPATCH_WINDOW);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: 'rate limit exceeded', retry_after_ms: rl.resetAt - Date.now() },
      { status: 429 },
    );
  }

  let body: SymphonyDispatchBody;
  try {
    body = (await request.json()) as SymphonyDispatchBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'invalid JSON body' },
      { status: 400 },
    );
  }

  if (!body || typeof body.prompt !== 'string' || !body.prompt.trim()) {
    return NextResponse.json(
      { ok: false, error: 'prompt (non-empty string) is required' },
      { status: 400 },
    );
  }

  try {
    const result = await dispatchSession(body);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof SymphonyError) {
      return NextResponse.json(
        { ok: false, error: err.message, detail: err.detail },
        { status: err.status >= 400 && err.status < 600 ? err.status : 502 },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: 'Symphony dashboard unreachable',
        detail: String(err),
      },
      { status: 502 },
    );
  }
}