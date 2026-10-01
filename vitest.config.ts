import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// A separate config from vite.config.ts (dev server) — this is ONLY for driving the real
// App component tree inside jsdom for a genuine browser-shaped reproduction of the auth
// bug (real React render + real reducer + real fetch() calls over real HTTP to the ALREADY
// RUNNING live dev server at http://localhost:5173, which is the exact same server/proxy a
// real browser talks to — with a real sessionStorage), since no actual browser engine is
// installable in this sandbox (no network path to any Chromium/Debian mirror or
// cdn.playwright.dev — confirmed by direct attempt, see AUTH_BROWSER_REPRO.md).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        // Relative fetch('/api/...') calls inside the app resolve against this, exactly
        // like a real browser tab whose address bar shows http://localhost:5173/ would —
        // and they go out over REAL HTTP to the REAL running Vite dev server + its real
        // proxy to the backend, not a mock.
        url: 'http://localhost:5173/',
      },
    },
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
