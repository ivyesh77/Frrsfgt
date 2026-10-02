import { useEffect, useState, useCallback } from 'react';
import { api, ApiError } from './api';

/** Fetches once on mount (and whenever `deps` change), with an optional auto-refresh
 *  interval for the "real-time" sections the spec calls for — always a real poll against
 *  the real backend, never a client-side timer that fabricates new values on its own. */
export function usePolling<T>(path: string, intervalMs: number | null = null, deps: unknown[] = [], enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    api
      .get<T>(path)
      .then((res) => {
        setData(res);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);

  useEffect(() => {
    if (!enabled) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    load();
    if (!intervalMs) return;
    const id = setInterval(load, intervalMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, intervalMs, enabled]);

  return { data, error, loading, reload: load };
}
