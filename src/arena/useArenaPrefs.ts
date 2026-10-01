import { useEffect, useState } from 'react';
import { effectiveReducedMotion, getPrefs, setPrefs, subscribePrefs, type ArenaPrefs } from './prefs';

/** Live-subscribes to the shared local preference store so every component (nav, settings
 *  screen, gameplay HUD) re-renders the instant a toggle changes anywhere, without prop
 *  drilling a prefs object through the whole tree. */
export function useArenaPrefs(): [ArenaPrefs, (update: Partial<ArenaPrefs>) => void] {
  const [prefs, setLocal] = useState<ArenaPrefs>(() => getPrefs());
  useEffect(() => subscribePrefs(setLocal), []);
  return [prefs, (update) => setPrefs(update)];
}

/** Convenience boolean most animated components actually want. */
export function useReducedMotion(): boolean {
  const [prefs] = useArenaPrefs();
  const [systemReduced, setSystemReduced] = useState(() => effectiveReducedMotion(prefs));
  useEffect(() => {
    setSystemReduced(effectiveReducedMotion(prefs));
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setSystemReduced(effectiveReducedMotion(prefs));
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [prefs]);
  return systemReduced;
}
