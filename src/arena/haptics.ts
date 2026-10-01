/**
 * Thin wrapper around `navigator.vibrate` — the only haptics API a web app can use.
 * Respects the user's Settings toggle and silently no-ops on any device/browser that
 * doesn't expose the API at all (most desktop browsers, iOS Safari) rather than throwing.
 */
import { getPrefs } from './prefs';

function vibrate(pattern: number | number[]): void {
  if (!getPrefs().hapticsEnabled) return;
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Some browsers throw if called outside a user gesture context — never let that
    // propagate into the action that triggered it.
  }
}

export const haptics = {
  tap: () => vibrate(10),
  correct: () => vibrate([12, 40, 18]),
  wrong: () => vibrate([30, 30, 30]),
  matchFound: () => vibrate([20, 60, 20, 60, 30]),
  countdownTick: () => vibrate(15),
  win: () => vibrate([20, 40, 20, 40, 60]),
  lose: () => vibrate(40),
};
