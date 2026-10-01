/**
 * TEST B — fresh browser, login (against a pre-existing account), observe exact result.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from '../../App';
import { BACKEND, fillAndSubmit, freshName, isOnAuthenticatedShell, openAuthModal } from './helpers';

describe('TEST B — fresh login', () => {
  it('login succeeds, Home renders authenticated, Session Expired never appears', async () => {
    const name = freshName('repro_login');
    const password = 'Passw0rd!123';

    // The account must already exist for a *login* test — create it out of band, directly
    // against the backend, independent of the UI under test.
    const signupRes = await fetch(`${BACKEND}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, password }),
    });
    expect(signupRes.status).toBe(200);

    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Log In' })).toBeTruthy(), { timeout: 10000 });
    expect(screen.queryByText(/session expired/i)).toBeNull();

    await openAuthModal(user, 'login');
    await fillAndSubmit(user, name, password, 'login');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 10000 });
    await waitFor(() => expect(isOnAuthenticatedShell()).toBe(true), { timeout: 10000 });
    expect(screen.queryByText(/session expired/i)).toBeNull();
  });
});
