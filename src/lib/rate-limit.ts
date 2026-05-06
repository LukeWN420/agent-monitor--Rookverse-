/**
 * In-memory rate limiter for API routes.
 *
 * Uses a sliding-window counter per IP. Lightweight, no external deps.
 * Suitable for a local dashboard — not for production edge use.
 */

const windows = new Map<string, { count: number; resetAt: number }>();

/** Clean up expired windows older than 2× their duration. */
function prune(now: number) {
  for (const [key, win] of windows) {
    if (win.resetAt < now) windows.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Check whether a request from `ip` is allowed under the rate limit.
 * @param ip      Client identifier (usually IP or a fixed key)
 * @param limit   Max requests per window
 * @param windowMs  Window duration in milliseconds
 */
export function checkRateLimit(
  ip: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  prune(now);

  const existing = windows.get(ip);
  if (!existing || existing.resetAt <= now) {
    // New window
    const resetAt = now + windowMs;
    windows.set(ip, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt };
  }

  if (existing.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count++;
  return { allowed: true, remaining: limit - existing.count, resetAt: existing.resetAt };
}

/** Convenience: extract client IP from Next.js request headers. */
export function clientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? request.headers.get('x-real-ip')
    ?? 'unknown'
  );
}