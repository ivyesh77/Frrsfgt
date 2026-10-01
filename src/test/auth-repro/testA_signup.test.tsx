/**
 * TEST A — fresh browser, signup, observe exact result.
 * Renders the real <App/> tree in jsdom (location = http://localhost:5173/, the real dev
 * server), drives a real click+type+submit through the real AuthModal, and asserts against
 * the real resulting DOM — no mocked fetch, no mocked state.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from '../../App';
import { fillAndSubmit, freshName, isOnAuthenticatedShell, openAuthModal } from './helpers';

describe('TEST A — fresh signup', () => {
  it('signup succeeds, Home renders authenticated, Session Expired never appears', async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(screen.getByRole('button', { name: /get started free/i })).toBeTruthy(), { timeout: 10000 });
    expect(screen.queryByText(/session expired/i)).toBeNull();

    await openAuthModal(user, 'signup');
    await fillAndSubmit(user, freshName('repro_signup'), 'Passw0rd!123', 'signup');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 10000 });
    await waitFor(() => expect(isOnAuthenticatedShell()).toBe(true), { timeout: 10000 });
    expect(screen.queryByText(/session expired/i)).toBeNull();
  });
});
