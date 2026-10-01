/**
 * TEST D/E — login, then navigate Home -> Profile -> Stats -> Wallet (real clicks on the
 * real nav), confirming every protected screen stays authenticated.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from '../../App';
import { fillAndSubmit, freshName, isOnAuthenticatedShell, openAuthModal } from './helpers';

describe('TEST D/E — Home -> Profile -> Stats -> Wallet', () => {
  it('navigating between protected screens never shows Session Expired and never drops the authenticated shell', async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getByRole('button', { name: /get started free/i })).toBeTruthy(), { timeout: 10000 });
    await openAuthModal(user, 'signup');
    await fillAndSubmit(user, freshName('repro_nav'), 'Passw0rd!123', 'signup');
    await waitFor(() => expect(isOnAuthenticatedShell()).toBe(true), { timeout: 10000 });

    // Home -> Profile
    await user.click(screen.getAllByText('Profile')[0]!);
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.queryByText(/session expired/i)).toBeNull();
    expect(isOnAuthenticatedShell()).toBe(true);

    // Profile -> Full Stats (a sub-screen, not a top-level nav tab)
    await user.click(screen.getByText('Full Stats'));
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.queryByText(/session expired/i)).toBeNull();
    expect(isOnAuthenticatedShell()).toBe(true);

    // -> Wallet
    await user.click(screen.getAllByText('Wallet')[0]!);
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.queryByText(/session expired/i)).toBeNull();
    expect(isOnAuthenticatedShell()).toBe(true);

    // -> back Home
    await user.click(screen.getAllByText('Home')[0]!);
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.queryByText(/session expired/i)).toBeNull();
    expect(isOnAuthenticatedShell()).toBe(true);
  });
});
