import { useEffect, useState } from 'react';

/** Real browser online/offline signal (navigator.onLine + the window events) — used to show
 *  an honest "you're offline" state rather than letting wallet/matchmaking actions fail
 *  silently or hang. This is a client-side UX hint only; it never substitutes for the
 *  server's own authority (a flaky connection that still reports `online` will simply get a
 *  real failed request, handled the normal error-toast way). */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    function onOnline() {
      setOnline(true);
    }
    function onOffline() {
      setOnline(false);
    }
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);
  return online;
}
