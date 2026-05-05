// ============================================================================
// GET /api/symphony/sessions
//
// Forwards to Symphony's `/sessions` endpoint and returns the raw registry
// payload to the frontend. Used by the meeting room to populate the live
// agent roster.
// ============================================================================

import { NextResponse } from 'next/server';
import { fetchSessions, SymphonyError } from '@/lib/symphony';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await fetchSessions();
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof SymphonyError) {
      return NextResponse.json(
        { ok: false, error: err.message, detail: err.detail },
        { status: 502 },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: 'Symphony dashboard unreachable',
        detail: String(err),
        hint: 'Run `python -m symphony.dashboard --port 8765` and confirm SYMPHONY_DASHBOARD_URL.',
      },
      { status: 502 },
    );
  }
}
