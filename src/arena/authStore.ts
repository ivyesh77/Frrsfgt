import { useEffect, useState } from 'react';
import { clearBearerToken, fetchMe, login as apiLogin, logout as apiLogout, setUnauthorizedHandler, signup as apiSignup } from './api';
import type { ArenaUser } from './types';

/**
 * The single source of truth for player authentication. The server's GET /me is the only
 * authority: the user object returned by login/signup is not trusted as proof until a fresh
 * /me request verifies the newly-created session.
 *
 * State meanings are deliberately narrow:
 *   checking        AUTH_LOADING: a credential check is in progress
 *   authenticated   AUTHENTICATED: /me returned 200
 *   unauthenticated UNAUTHENTICATED: /me returned a confirmed 401
 *   error           AUTH_ERROR: the server could not give a definitive answer
 *
 * A monotonically increasing operation id prevents an older bootstrap, verification, or
 * expiry check from overwriting a newer login/logout result. This matters in real browsers
 * where slow requests can resolve out of order, and not only in tests.
 */
export type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated' | 'error';

export interface AuthState {
  status: AuthStatus;
  user: ArenaUser | null;
  /** Only meaningful when status === 'error'. */
  bootstrapError: string | null;
  /** Set only after a confirmed 401 from a session that was previously authenticated. */
  expiryReason: string | null;
}

type Listener = (state: AuthState) => void;

const BOOTSTRAP_BACKOFF_MS = [500, 1500, 3000];

class AuthStore {
  private state: AuthState = { status: 'checking', user: null, bootstrapError: null, expiryReason: null };
  private listeners = new Set<Listener>();
  private inFlightCheck: Promise<ArenaUser | null> | null = null;
  private operation = 0;

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

  /** One coalesced /me request for bootstrap and confirmed-expiry checks. A 401 is returned
   * as null; every other HTTP or network failure rejects so callers can preserve AUTH_ERROR
   * rather than guessing that the session is gone. */
  private checkSession(): Promise<ArenaUser | null> {
    if (!this.inFlightCheck) {
      this.inFlightCheck = fetchMe().finally(() => {
        this.inFlightCheck = null;
      });
    }
    return this.inFlightCheck;
  }

  /** Initial session validation. Only a confirmed /me 401 becomes unauthenticated; a
   * transient 500/502/503, 403/429, network error, or timeout is retried and then surfaced
   * as AUTH_ERROR with a Retry action. */
  async bootstrap(): Promise<void> {
    const operation = ++this.operation;
    this.setState({ status: 'checking', bootstrapError: null, expiryReason: null });

    for (let attempt = 0; attempt <= BOOTSTRAP_BACKOFF_MS.length; attempt += 1) {
      try {
        const user = await this.checkSession();
        if (operation !== this.operation) return;
        if (user) {
          this.setState({ status: 'authenticated', user, bootstrapError: null, expiryReason: null });
        } else {
          clearBearerToken();
          this.setState({ status: 'unauthenticated', user: null, bootstrapError: null, expiryReason: null });
        }
        return;
      } catch (err) {
        if (operation !== this.operation) return;
        if (attempt === BOOTSTRAP_BACKOFF_MS.length) {
          const message = err instanceof Error ? err.message : 'Could not reach the server';
          this.setState({ status: 'error', user: null, bootstrapError: message });
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, BOOTSTRAP_BACKOFF_MS[attempt]));
      }
    }
  }

  retryBootstrap(): void {
    void this.bootstrap();
  }

  /** Login/signup is a two-step protocol: the auth endpoint issues a server session, then
   * the client immediately verifies that exact credential through /me before exposing the
   * authenticated app. A successful auth response alone never drives navigation. */
  private async establishSession(authRequest: (name: string, password: string) => Promise<ArenaUser>, name: string, password: string): Promise<void> {
    const operation = ++this.operation;
    let credentialAccepted = false;
    let verificationConfirmedUnauthenticated = false;
    try {
      await authRequest(name, password);
      credentialAccepted = true;

      // Do not use an older in-flight bootstrap here: it may have been sent before the new
      // credential existed and could return a stale 401. This verification reads the latest
      // bearer token/cookie and is the only response allowed to establish AUTHENTICATED.
      const verifiedUser = await fetchMe();
      if (operation !== this.operation) return;
      if (!verifiedUser) {
        verificationConfirmedUnauthenticated = true;
        clearBearerToken();
        this.setState({ status: 'unauthenticated', user: null, bootstrapError: null, expiryReason: null });
        throw new Error('Authentication could not be verified. Please try again.');
      }
      this.setState({ status: 'authenticated', user: verifiedUser, bootstrapError: null, expiryReason: null });
    } catch (err) {
      if (operation !== this.operation) return;
      if (credentialAccepted && !verificationConfirmedUnauthenticated) {
        // The login/signup endpoint succeeded but /me did not provide a definitive 200.
        // Keep this separate from a real logout so a 500/network failure gets a retryable
        // connection-error screen rather than a misleading "Session expired" message.
        const message = err instanceof Error ? err.message : 'Could not verify the session';
        this.setState({ status: 'error', user: null, bootstrapError: message, expiryReason: null });
      } else if (verificationConfirmedUnauthenticated) {
        // /me did answer definitively: this credential is not usable. Keep the auth modal
        // available for another attempt, but do not show a global expiry banner because the
        // player was never authenticated in this operation.
        this.setState({ status: 'unauthenticated', user: null, bootstrapError: null, expiryReason: null });
      } else {
        // Bad credentials, 403 forbidden, 429 rate limit, or another auth-endpoint error
        // belongs inline in the modal. It must not turn into a global session-expiry state.
        this.setState({ status: 'unauthenticated', user: null, bootstrapError: null });
      }
      throw err;
    }
  }

  async login(name: string, password: string): Promise<void> {
    await this.establishSession(apiLogin, name, password);
  }

  async signup(name: string, password: string): Promise<void> {
    await this.establishSession(apiSignup, name, password);
  }

  /** Logout always clears this tab's credential, while the server invalidates the session
   * whenever the request reaches it. A failed network call is not relabeled as success. */
  async logout(): Promise<void> {
    ++this.operation;
    await apiLogout().catch(() => {});
    this.setState({ status: 'unauthenticated', user: null, bootstrapError: null, expiryReason: null });
  }

  /** The only path that can move an authenticated tab to logged out after startup. Any
   * protected 401 is re-confirmed by /me; all non-401/network failures leave valid auth
   * state untouched. */
  async confirmExpiryOrIgnore(): Promise<void> {
    if (this.state.status !== 'authenticated') return;
    const operation = this.operation;
    try {
      const user = await this.checkSession();
      if (operation !== this.operation || this.state.status !== 'authenticated') return;
      if (user) {
        // /me can return a fresher server projection (for example after another tab
        // rotated the session). Keep the authenticated state and accept only that server
        // identity; never infer it from a client-side name/id.
        if (user.id !== this.state.user?.id) this.setState({ user });
        return;
      }

      // A protected request can have failed because a stale bearer token disagreed with a
      // still-valid httpOnly cookie (for example after signing into another account in a
      // second tab). Confirm once with the bearer deliberately omitted before declaring an
      // actual expiry. If that retry is a 5xx/network failure, the catch below preserves
      // the existing auth state and token.
      const cookieUser = await fetchMe({ withoutBearer: true });
      if (operation !== this.operation || this.state.status !== 'authenticated') return;
      if (cookieUser) {
        clearBearerToken();
        this.setState({ user: cookieUser });
        return;
      }
      clearBearerToken();
      this.setState({ status: 'unauthenticated', user: null, expiryReason: 'Your session expired — please sign in again.' });
    } catch {
      // Inconclusive: never destroy a valid authenticated UI because of a temporary failure.
    }
  }

  clearExpiryReason(): void {
    if (this.state.expiryReason) this.setState({ expiryReason: null });
  }

  updateUser(user: ArenaUser): void {
    if (this.state.status !== 'authenticated') return;
    this.setState({ user });
  }
}

export const authStore = new AuthStore();

setUnauthorizedHandler(() => {
  void authStore.confirmExpiryOrIgnore();
});

export function useAuthState(): AuthState {
  const [state, setState] = useState(authStore.getState());
  useEffect(() => authStore.subscribe(setState), []);
  return state;
}
