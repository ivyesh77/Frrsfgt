import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { disconnectArenaSocket } from '../arena/socket';

// jsdom does not implement `fetch` itself (long-standing, documented jsdom limitation —
// it has no network stack of its own); vitest's jsdom environment falls back to Node's
// native (undici) `fetch`, which — unlike every real browser's `fetch` — refuses relative
// URLs outright instead of resolving them against the current page's location. The real
// app code (src/arena/api.ts) calls `fetch('/api/...')` with a relative path exactly as it
// would in a real browser tab, relying on that browser behavior. This wrapper restores
// that one piece of real-browser fetch semantics for the test harness only — it does not
// change what request goes out, what headers/credentials are sent, or how the response is
// handled; it only resolves the URL the exact same way `window.location` would.
const nativeFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  if (typeof input === 'string' && input.startsWith('/')) {
    return nativeFetch(new URL(input, window.location.href).toString(), init);
  }
  return nativeFetch(input, init);
}) as typeof fetch;

afterEach(() => {
  cleanup();
  disconnectArenaSocket();
});
