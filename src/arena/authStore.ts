import { useEffect, useState } from 'react';
import { fetchMe, login as apiLogin, logout as apiLogout, setUnauthorizedHandler, signup as apiSignup } from './api';
import type { ArenaUser } from './types';

/**
 * ---------------------------------------------------------------------------------------
 * THE single source of truth for "is this browser tab logged in right now".
 *
 * Previously this decision was spread across three separate places in useArena.ts (the
 * bootstrap effect, a global `onUnauthorized` handler with its own closure-local
 * `confirming` flag, and the socket's `connect_error` handler), each with its own,
 * independently-written copy of "is this 401 real or should I double-check first". That
 * was hard to audit precisely because it was hard to prove there wasn't a fourth place
 * that needed the same guard. This file is the rewrite: exactly one class, exactly one
 * de-duplicated "ask the server" primitive, and three narrow, named entry points (bootstrap,
 * explicit login/signup, and "something smells like an expired session — confirm before
 * acting") that are each independently simple enough to read top to bottom.
 *
 * Nothing in this file ever trusts a client-side opinion about who is logged in. The only
 * fact this store ever asserts is exactly what the server's own GET /api/auth/me most
 * recently said — never a cached/assumed value, never a client-supplied id.
 * ---------------------------------------------------------------------------------------
 */

export type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated' | 'error';

export interface AuthState {
  status: AuthStatus;
  user: ArenaUser | null;
  /** Only meaningful when status === 'error': the initial bootstrap check never got a
   *  definitive answer after retrying (network error, or a 403/429/500/502/503 from the
   *  server). Deliberately distinct from 'unauthenticated' — an inconclusive check must
   *  never render as "please log in" (indistinguishable from a real logout to the player)
   *  and must never render as "logged in" either (a fake, unverified logged-in state). */
  bootstrapError: string | null;
  /** A one-time, user-facing reason to show immediately after a REAL, confirmed session
   *  loss (e.g. "Your session expired — please sign in again."). Cleared by the next
   *  successful login/signup or by `clearExpiryReason()`. */
  expiryReason: string | null;
}

type Listener = (state: AuthState) => void;

const BOOTSTRAP_BACKOFF_MS = [500, 1500, 3000];

class AuthStore {
  private state: AuthState = { status: 'checking', user: null, bootstrapError: null, expiryReason: null };
  private listeners = new Set<Listener>();

  // Coalesces concurrent "is my session still valid" checks into exactly one in-flight
  // GET /me — a burst of several protected calls all failing with 401 at once (e.g. right
  // after a server restart) triggers only ONE confirmation round-trip, never N, and two
  // callers racing each other can never observe two different answers.
  private inFlightCheck: Promise<ArenaUser | null> | null = null;

  getState(): AuthState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private setState(patch: Partial<AuthState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  /** The one and only definitive "ask the server" call. Resolves with the user (or `null`
   *  for a confirmed, clean 401) — exactly `fetchMe()`'s own contract — and genuinely
   *  throws for anything inconclusive (network error, 403/429/500/502/503), so every
   *  caller below can tell "confirmed logged out" apart from "could not find out". */
  private checkSession(): Promise<ArenaUser | null> {
    if (!this.inFlightCheck) {
      this.inFlightCheck = fetchMe().finally(() => {
        this.inFlightCheck = null;
      });
    }
    return this.inFlightCheck;
  }

  /** Called exactly once, when the app first mounts: "are we already logged in?" Retries a
   *  bounded number of times (never forever) on an inconclusive result before giving up and
   *  surfacing `status: 'error'` — it never guesses `authenticated` or `unauthenticated`
   *  from an inconclusive check. */
  async bootstrap(): Promise<void> {
    this.setState({ status: 'checking', bootstrapError: null });
    for (let attempt = 0; attempt <= BOOTSTRAP_BACKOFF_MS.length; attempt++) {
      try {
        const user = await this.checkSession();
        this.setState({ status: user ? 'authenticated' : 'unauthenticated', user, bootstrapError: null });
        return;
      } catch (err) {
        if (attempt === BOOTSTRAP_BACKOFF_MS.length) {
          const message = err instanceof Error ? err.message : 'Could not reach the server';
          this.setState({ status: 'error', bootstrapError: message });
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, BOOTSTRAP_BACKOFF_MS[attempt]));
      }
    }
  }

  retryBootstrap(): void {
    void this.bootstrap();
  }

  /** Real credential verification against the server — throws on bad credentials, a
   *  suspended account, etc., which the caller (the auth modal) shows inline. On success
   *  the resulting user is exactly what the server just returned, never an optimistic
   *  guess, and any previous expiry banner is cleared. */
  async login(name: string, password: string): Promise<void> {
    const user = await apiLogin(name, password);
    this.setState({ status: 'authenticated', user, expiryReason: null });
  }

  async signup(name: string, password: string): Promise<void> {
    const user = await apiSignup(name, password);
    this.setState({ status: 'authenticated', user, expiryReason: null });
  }

  /** Tells the server to invalidate the session, then forgets it client-side regardless of
   *  whether that network call actually succeeded — a dropped logout request must never
   *  leave the player stuck looking logged in. */
  async logout(): Promise<void> {
    await apiLogout().catch(() => {});
    this.setState({ status: 'unauthenticated', user: null, expiryReason: null });
  }

  /**
   * The ONLY path that can ever move an already-authenticated tab to logged-out after
   * startup. Called whenever something merely *suspects* the session is gone — a protected
   * REST call came back 401, or the realtime socket's handshake was rejected with
   * "Unauthorized" — and it NEVER itself logs anyone out. It only ever re-asks the server
   * (via the same de-duplicated `checkSession()` bootstrap uses) and logs out if and only
   * if that fresh check comes back with a clean, confirmed "no". A network error or a
   * 403/429/500/502/503 while checking is inconclusive and leaves the authenticated state
   * completely untouched — the screen that hit the original error shows its own local
   * "couldn't load, try again" message instead.
   */
  async confirmExpiryOrIgnore(): Promise<void> {
    if (this.state.status !== 'authenticated') return; // nothing to lose — never misfires for a pre-login 401
    try {
      const user = await this.checkSession();
      if (user) return; // false alarm — a racing/dropped request, not a real expiry
      this.setState({ status: 'unauthenticated', user: null, expiryReason: 'Your session expired — please sign in again.' });
    } catch {
      // Inconclusive — do nothing. A temporary server hiccup must never look like a logout.
    }
  }

  clearExpiryReason(): void {
    if (this.state.expiryReason) this.setState({ expiryReason: null });
  }

  /** Patches in a fresher copy of the authenticated user (e.g. after a wallet top-up/
   *  withdraw/match-end returns the server's own updated balance) without touching auth
   *  status at all — a no-op if this tab isn't currently authenticated. */
  updateUser(user: ArenaUser): void {
    if (this.state.status !== 'authenticated') return;
    this.setState({ user });
  }
}

export const authStore = new AuthStore();

// Wired once, at module load, directly to the store rather than re-registered by a React
// effect on every mount — this is a true singleton for the lifetime of the tab, so there is
// no StrictMode double-mount/unmount window where the handler is briefly unset.
setUnauthorizedHandler(() => {
  void authStore.confirmExpiryOrIgnore();
});

/** The one hook every component needs to read current auth state — a thin subscription
 *  over the singleton above, so React re-renders when (and only when) it actually changes. */
export function useAuthState(): AuthState {
  const [state, setState] = useState(authStore.getState());
  useEffect(() => authStore.subscribe(setState), []);
  return state;
}
