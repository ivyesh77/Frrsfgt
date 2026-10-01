/**
 * TEST C/18 — login (via signup), then simulate a real page refresh, confirm still
 * authenticated. "Refresh" is modeled as: throw away the whole React tree + the JS module
 * graph (vi.resetModules + re-import), which is exactly what happens to in-memory JS state
 * on a real browser refresh, while keeping the same jsdom window/sessionStorage/cookie-jar
 * (a real refresh is the same tab, same storage — it does not create a new one).
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import App from '../../App';
import { fillAndSubmit, freshName, isOnAuthenticatedShell, openAuthModal } from './helpers';

describe('TEST C/18 — login then refresh', () => {
  it('signup, then a real-refresh simulation, stays authenticated (no Session Expired)', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await waitFor(() => expect(screen.getByRole('button', { name: /get started free/i })).toBeTruthy(), { timeout: 10000 });

    await openAuthModal(user, 'signup');
    await fillAndSubmit(user, freshName('repro_refresh'), 'Passw0rd!123', 'signup');
    await waitFor(() => expect(isOnAuthenticatedShell()).toBe(true), { timeout: 10000 });

    const tokenBeforeRefresh = sessionStorage.getItem('arena_session_token');
    expect(tokenBeforeRefresh).toBeTruthy();

    unmount();
    vi.resetModules();
    const { default: FreshApp } = await import('../../App');

    render(<FreshApp />);
    await waitFor(
      () => {
        expect(screen.queryByText(/session expired/i)).toBeNull();
        expect(isOnAuthenticatedShell()).toBe(true);
      },
      { timeout: 10000 },
    );
  });
});
