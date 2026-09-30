/**
 * A tiny in-memory, sliding-window event counter — the raw material both risk.ts and
 * anticheat.ts derive real signals from. Every call site that feeds this module (rooms.ts,
 * index.ts) is recording something that ACTUALLY happened server-side (a real rejected
 * answer, a real reconnect, a real failed login) — nothing here is synthetic/sampled data.
 * This intentionally does not persist across a restart (it resets to empty), which is an
 * honest, disclosed limitation for a single in-memory process — see ADMIN_REPORT.md.
 */
interface Bucket {
  timestamps: number[];
}

const buckets = new Map<string, Bucket>();

function key(kind: string, subject: string): string {
  return `${kind}:${subject}`;
}

export function recordEvent(kind: string, subject: string): void {
  const k = key(kind, subject);
  const bucket = buckets.get(k) ?? { timestamps: [] };
  bucket.timestamps.push(Date.now());
  if (bucket.timestamps.length > 500) bucket.timestamps = bucket.timestamps.slice(-500);
  buckets.set(k, bucket);
}

export function countEvent(kind: string, subject: string, windowMs: number): number {
  const bucket = buckets.get(key(kind, subject));
  if (!bucket) return 0;
  const cutoff = Date.now() - windowMs;
  return bucket.timestamps.filter((t) => t > cutoff).length;
}

/** Global (all-subjects) count for a kind within a window — used for platform-wide
 *  dashboard tiles like "rejected requests in the last hour" without needing to know every
 *  individual subject id in advance. */
export function countAllEvents(kind: string, windowMs: number): number {
  const cutoff = Date.now() - windowMs;
  let total = 0;
  for (const [k, bucket] of buckets) {
    if (!k.startsWith(`${kind}:`)) continue;
    total += bucket.timestamps.filter((t) => t > cutoff).length;
  }
  return total;
}

/** Every distinct subject that has recorded at least one event of `kind` within the
 *  window, alongside its count — used to list "which users triggered this signal". */
export function topSubjects(kind: string, windowMs: number, limit = 20): Array<{ subject: string; count: number }> {
  const cutoff = Date.now() - windowMs;
  const results: Array<{ subject: string; count: number }> = [];
  for (const [k, bucket] of buckets) {
    if (!k.startsWith(`${kind}:`)) continue;
    const subject = k.slice(kind.length + 1);
    const count = bucket.timestamps.filter((t) => t > cutoff).length;
    if (count > 0) results.push({ subject, count });
  }
  return results.sort((a, b) => b.count - a.count).slice(0, limit);
}

export function __resetSignalsForTests(): void {
  buckets.clear();
}
