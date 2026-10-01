/**
 * Local, non-financial, non-identity user preferences only: sound/music/haptics toggles
 * and a reduced-motion override. This is the ONLY thing this app ever persists to
 * localStorage — never an account id, a session token, a wallet balance, or anything the
 * server is the authority on (see AUDIT_REPORT.md / SECURITY_FIX_REPORT.md for why
 * identity/balance were removed from localStorage entirely). Losing these preferences
 * (private browsing, a cleared cache) has zero security or financial consequence — at
 * worst the app just defaults back to sound+haptics on, which is harmless.
 */

export interface ArenaPrefs {
  soundEnabled: boolean;
  musicEnabled: boolean;
  hapticsEnabled: boolean;
  /** Explicit user override. `null` means "follow the OS/browser's prefers-reduced-motion
   *  setting" (see useReducedMotion below) rather than silently defaulting to false. */
  reducedMotion: boolean | null;
}

const STORAGE_KEY = 'arena:prefs:v1';

const DEFAULT_PREFS: ArenaPrefs = {
  soundEnabled: true,
  musicEnabled: false,
  hapticsEnabled: true,
  reducedMotion: null,
};

function readPrefs(): ArenaPrefs {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<ArenaPrefs>;
    return {
      soundEnabled: typeof parsed.soundEnabled === 'boolean' ? parsed.soundEnabled : DEFAULT_PREFS.soundEnabled,
      musicEnabled: typeof parsed.musicEnabled === 'boolean' ? parsed.musicEnabled : DEFAULT_PREFS.musicEnabled,
      hapticsEnabled: typeof parsed.hapticsEnabled === 'boolean' ? parsed.hapticsEnabled : DEFAULT_PREFS.hapticsEnabled,
      reducedMotion: typeof parsed.reducedMotion === 'boolean' ? parsed.reducedMotion : null,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

let cached: ArenaPrefs | null = null;
const listeners = new Set<(prefs: ArenaPrefs) => void>();

export function getPrefs(): ArenaPrefs {
  if (!cached) cached = readPrefs();
  return cached;
}

export function setPrefs(update: Partial<ArenaPrefs>): ArenaPrefs {
  const next = { ...getPrefs(), ...update };
  cached = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private-browsing/storage-full — preferences just won't persist across reloads;
    // never a reason to throw or block the action that triggered this.
  }
  listeners.forEach((l) => l(next));
  return next;
}

export function subscribePrefs(listener: (prefs: ArenaPrefs) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True OS/browser-level signal, independent of our own override above — combined with it
 *  in useReducedMotion(). */
export function systemPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The single function every animated component should consult: the user's explicit
 *  choice in Settings wins if set, otherwise fall back to the OS-level signal. */
export function effectiveReducedMotion(prefs: ArenaPrefs = getPrefs()): boolean {
  return prefs.reducedMotion ?? systemPrefersReducedMotion();
}
