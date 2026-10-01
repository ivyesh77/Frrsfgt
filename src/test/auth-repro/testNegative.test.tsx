/**
 * TEST 19 — negative control: a GENUINELY invalidated session must still correctly show
 * the logged-out/login screen. This proves the expiry handling still works for a real 401
 * and the earlier "never show Session Expired" assertions in the other tests aren't simply
 * because the app treats everything as success.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '../../App';
import { BACKEND, freshName } from './helpers';

describe('TEST 19 — negative test: real session invalidation', () => {
  it('after the server session is actually destroyed, the app correctly shows the logged-out screen', async () => {
    const name = freshName('repro_negative');

    // Log in through the REAL UI first, so the real cookie (scoped to localhost:5173, the
    // origin the app itself uses) gets set exactly the way a genuine session would be.
    const userEventModule = await import('@testing-library/user-event');
    const user = userEventModule.default.setup();
    const { fillAndSubmit, openAuthModal, isOnAuthenticatedShell } = await import('./helpers');

    render(<App />);
    await waitFor(() => expect(screen.getByRole('button', { name: /get started free/i })).toBeTruthy(), { timeout: 10000 });
    await openAuthModal(user, 'signup');
    await fillAndSubmit(user, name, 'Passw0rd!123', 'signup');
    await waitFor(() => expect(isOnAuthenticatedShell()).toBe(true), { timeout: 10000 });

    const token = sessionStorage.getItem('arena_session_token');
    expect(token).toBeTruthy();

    // Now genuinely destroy that exact session server-side (both the cookie's session and
    // the bearer token are the SAME underlying session record — logging out with the
    // bearer token destroys the one session this tab is actually using).
    const logoutRes = await fetch(`${BACKEND}/api/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    expect(logoutRes.status).toBe(200);

    // TEST 6 requirement: after logout, a protected API call with the now-dead token must
    // return exactly 401 (not 403/500/anything else) — this is the literal status code the
    // rest of the app's error classification depends on to ever show "session expired" at
    // all, so it must be a real, checked fact here, not just inferred from UI behavior.
    const meAfterLogout = await fetch(`${BACKEND}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    expect(meAfterLogout.status).toBe(401);

    // A fresh "page" (same tab/cookies, module state reset) must now correctly detect the
    // real 401 and show the logged-out screen — not keep rendering as authenticated.
    const vitestMod = await import('vitest');
    vitestMod.vi.resetModules();
    const { default: FreshApp } = await import('../../App');

    render(<FreshApp />);
    await waitFor(() => expect(screen.getByRole('button', { name: /get started free/i })).toBeTruthy(), { timeout: 10000 });
  });
});
