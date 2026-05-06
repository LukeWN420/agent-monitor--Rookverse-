/**
 * CSRF Protection Utility
 * Validates Origin/Referer headers for state-changing requests
 */

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') || [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3200',
];

export function validateCSRF(origin: string | null, referer: string | null): boolean {
  if (!origin && !referer) {
    return false;
  }

  const checkUrl = origin || referer;
  if (!checkUrl) return false;

  return ALLOWED_ORIGINS.some(allowed => 
    checkUrl.startsWith(allowed)
  );
}

// CSRF token mechanism removed — origin/referer validation is the
// active protection. A hardcoded fallback token provides no real security
// and gives false confidence. If token-based CSRF is needed later,
// implement it properly with per-session nonces.
// See: REVIEW.md recommendation #6.
