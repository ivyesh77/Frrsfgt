/**
 * A transient 500 on the very first bootstrap /me call must never be indistinguishable
 * from "you are logged out" — it must retry, not immediately show the login screen.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '../../App';

describe('transient 5xx during bootstrap', () => {
  it('a real 500 from the first /me call does not render the login screen before retrying', async () => {
    const realFetch = globalThis.fetch;
    let meCallCount = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        meCallCount += 1;
        if (meCallCount === 1) {
          return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        }
      }
      return realFetch(input, init);
    }) as typeof fetch;

    try {
      render(<App />);
      await waitFor(() => expect(meCallCount).toBeGreaterThanOrEqual(1), { timeout: 5000 });
      // Immediately after the first (failed, 500) attempt resolves, we must NOT already be
      // showing the ordinary "you are logged out" screen — a 500 is not a 401.
      expect(screen.queryByRole('button', { name: /get started free/i })).toBeNull();
      expect(screen.queryByText(/session expired/i)).toBeNull();
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
