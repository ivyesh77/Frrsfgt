import { useEffect, useState } from 'react';

/**
 * Returns a `Date.now()` value that re-renders every `intervalMs`. The
 * interval only triggers a re-render — every consumer must recompute actual
 * elapsed/remaining time from real timestamps (e.g. `endsAt - now`), never
 * by counting ticks, so drift/backgrounding never desyncs the countdown.
 */
export function useNow(intervalMs = 100): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
