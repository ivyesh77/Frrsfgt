/**
 * Minimal in-memory sliding-window rate limiter for Socket.IO events (REST endpoints use
 * the `express-rate-limit` package instead — see index.ts). This exists specifically
 * because "the frontend won't send requests that fast" is not a security control — the
 * server has to reject abuse itself regardless of what any particular client does.
 */
const hits = new Map<string, number[]>();

/** Returns `true` if `key` is still within `limit` events per `windowMs`, and records this
 *  call as one of them. Returns `false` (and does NOT count this call) once the limit is
 *  exceeded, so a caller can safely retry after the window rolls over. */
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const cutoff = now - windowMs;
  const timestamps = (hits.get(key) ?? []).filter((t) => t > cutoff);
  if (timestamps.length >= limit) {
    hits.set(key, timestamps);
    return false;
  }
  timestamps.push(now);
  hits.set(key, timestamps);
  return true;
}

/** Test-only escape hatch so the self-test suite starts from a clean slate. */
export function __resetRateLimitsForTests(): void {
  hits.clear();
}
