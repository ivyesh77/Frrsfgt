import { useEffect } from 'react';
import { useReducedMotion } from './useArenaPrefs';

/** Applies a `reduced-motion` class to the document root whenever the EFFECTIVE reduced-
 *  motion state is true (the user's explicit Settings toggle, or — if they haven't set one
 *  — the OS-level `prefers-reduced-motion: reduce` signal). This exists alongside the plain
 *  `@media (prefers-reduced-motion: reduce)` CSS rule (which only reacts to the OS signal)
 *  so a player who explicitly turns "Reduce motion" on in Settings gets the same effect
 *  even on a device/browser that itself reports full motion. */
export function useGlobalReducedMotionClass(): void {
  const reduced = useReducedMotion();
  useEffect(() => {
    document.documentElement.classList.toggle('reduced-motion', reduced);
    return () => {
      document.documentElement.classList.remove('reduced-motion');
    };
  }, [reduced]);
}
