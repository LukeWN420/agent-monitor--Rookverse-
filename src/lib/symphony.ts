// ============================================================================
// Symphony control plane client
//
// Thin typed wrapper around Symphony's FastAPI dashboard at
// `SYMPHONY_DASHBOARD_URL` (default http://127.0.0.1:8765). Used by the
// `/api/symphony/*` proxy routes; never called directly from the browser.
//
// Symphony responsibilities (per Phase A contract):
// - Owns dispatch + lifecycle of persistent OpenClaw sessions
// - Exposes the session registry over HTTP
//
// Dashboard responsibilities:
// - Routes user messages to gateway via its own /api/gateway/action
//   (which authenticates) — Symphony NEVER messages sessions on our behalf.
// ============================================================================

export const SYMPHONY_DASHBOARD_URL =
  process.env.SYMPHONY_DASHBOARD_URL || 'http://127.0.0.1:8765';

/** Single session entry as returned by Symphony's /sessions endpoint. */
export interface SymphonySession {
  symphony_id: string;
  session_key: string;
  agent_id: string;
  name: string;
  emoji: string;
  status: string;
  task: string;
  issue_identifier: string;
  issue_id: string;
  spawned_at: string;
  last_active: string;
  last_run_id: string | null;
  extra: Record<string, unknown>;
}

export interface SymphonySessionsResponse {
  ok: boolean;
  registry_path?: string;
  count: number;
  sessions: SymphonySession[];
}

export interface SymphonyDispatchBody {
  prompt: string;
  agent_id?: string;
  issue_id?: string;
  issue_identifier?: string;
  task?: string;
  workspace?: string;
  name?: string;
  emoji?: string;
  thinking_level?: string;
  turn_timeout_ms?: number;
  /**
   * Marks the spawned session as intended for ongoing conversation.
   * Surfaced as metadata on the registry entry; the gateway-side session
   * key is persistent regardless. See Phase A's PersistentSessionRunner.
   */
  persistent?: boolean;
}

export interface SymphonyDispatchResponse {
  ok: boolean;
  /**
   * Async lifecycle stage. `spawning` = subprocess started, registry
   * placeholder written, work continues in the background. `working` /
   * `error` are emitted only when the dashboard caller chose
   * `wait_for_completion=true` (default is async). Phase A added this.
   */
  status?: 'spawning' | 'working' | 'error';
  exit_code: number | null;
  duration_ms: number;
  symphony_id: string | null;
  session_key: string | null;
  agent_id: string | null;
  stdout_tail?: string;
  stderr_tail?: string;
  error?: string | null;
}

interface FetchOptions {
  signal?: AbortSignal;
  /** Override the URL for tests / multi-Symphony deployments. */
  baseUrl?: string;
}

async function callSymphony<T>(
  path: string,
  init: RequestInit,
  opts: FetchOptions = {},
): Promise<T> {
  const base = opts.baseUrl ?? SYMPHONY_DASHBOARD_URL;
  const url = `${base.replace(/\/$/, '')}${path}`;
  const res = await fetch(url, { ...init, signal: opts.signal });
  if (!res.ok) {
    let detail: unknown;
    try {
      detail = await res.json();
    } catch {
      detail = await res.text().catch(() => '<no body>');
    }
    throw new SymphonyError(res.status, `Symphony ${path} → ${res.status}`, detail);
  }
  return (await res.json()) as T;
}

export class SymphonyError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, message: string, detail: unknown) {
    super(message);
    this.name = 'SymphonyError';
    this.status = status;
    this.detail = detail;
  }
}

export async function fetchSessions(opts: FetchOptions = {}): Promise<SymphonySessionsResponse> {
  return callSymphony<SymphonySessionsResponse>('/sessions', { method: 'GET' }, opts);
}

export async function dispatchSession(
  body: SymphonyDispatchBody,
  opts: FetchOptions = {},
): Promise<SymphonyDispatchResponse> {
  return callSymphony<SymphonyDispatchResponse>(
    '/sessions/dispatch',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    opts,
  );
}

export async function findSessionKey(
  symphonyId: string,
  opts: FetchOptions = {},
): Promise<string | null> {
  // Pull the registry once and look up by symphony_id. The registry is
  // small (tens of entries at most), so doing one list + scan is cheaper
  // than maintaining a /sessions/<id> client and avoids the second roundtrip.
  const list = await fetchSessions(opts);
  const match = list.sessions.find((s) => s.symphony_id === symphonyId);
  return match?.session_key || null;
}
