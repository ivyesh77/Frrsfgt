import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

export const BACKEND = 'http://localhost:8787';

/** Must fit the real AuthModal's `maxLength={24}` display-name input — a name longer than
 *  that would be silently truncated by the real UI exactly as it would in a real browser,
 *  which is correct browser behavior, not a bug; the test data just has to respect it. */
export function freshName(prefix: string): string {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`;
  const base = `${prefix}_${suffix}`;
  return base.slice(0, 24);
}

export async function openAuthModal(user: ReturnType<typeof userEvent.setup>, which: 'signup' | 'login') {
  const button = which === 'signup' ? screen.getByRole('button', { name: /get started free/i }) : screen.getByRole('button', { name: 'Log In' });
  await user.click(button);
  await screen.findByRole('dialog');
}

export async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>, name: string, password: string, mode: 'signup' | 'login') {
  const dialog = screen.getByRole('dialog');
  await user.type(within(dialog).getByLabelText(/display name/i), name);
  await user.type(within(dialog).getByLabelText(/^password$/i), password);
  const submitName = mode === 'signup' ? /create account/i : /^log in$/i;
  await user.click(within(dialog).getByRole('button', { name: submitName }));
}

/** The authenticated app shell (persistent nav) renders on every protected screen
 *  (Home/Play/Wallet/History/Profile/Stats/...), so this is a reliable "are we actually
 *  authenticated right now" signal regardless of which tab is active. The shell renders
 *  the same nav label (e.g. "Wallet") twice at once — desktop sidebar + mobile bottom nav
 *  — so a plain `getByText('Wallet')` is ambiguous; querying by the shell's own
 *  aria-label is not. */
export function isOnAuthenticatedShell(): boolean {
  return screen.queryAllByLabelText('Primary navigation').length > 0;
}
