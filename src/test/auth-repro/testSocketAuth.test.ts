import { describe, expect, it, afterEach } from 'vitest';
import { signup } from '../../arena/api';
import { getArenaSocket, disconnectArenaSocket } from '../../arena/socket';

// ---------------------------------------------------------------------------
// TEST 12 — Socket.IO authentication, audited separately from HTTP auth.
//
// This uses the REAL, unmodified `signup()` from src/arena/api.ts (so the real bearer
// token actually ends up in the real module-level state `getArenaSocket()` reads from)
// and the REAL, unmodified `getArenaSocket()` from src/arena/socket.ts (same `io(...)`
// call, same transports array, same `auth` callback the live app uses) — connecting, over
// real HTTP/WebSocket, through the actual running Vite dev server's `/socket.io` proxy to
// the actual running backend. Nothing here is mocked or reimplemented.
// ---------------------------------------------------------------------------

afterEach(() => {
  disconnectArenaSocket();
});

function waitForOutcome(socket: ReturnType<typeof getArenaSocket>): Promise<{ ok: true } | { ok: false; message: string }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, message: 'TIMEOUT — neither connect nor connect_error fired in 8s' }), 8000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve({ ok: true });
    });
    socket.once('connect_error', (err: Error) => {
      clearTimeout(timer);
      resolve({ ok: false, message: err.message });
    });
  });
}

describe('TEST 12 — Socket.IO auth, audited separately from HTTP auth', () => {
  it('a freshly signed-up session authenticates the real socket connection using the real bearer token', async () => {
    const name = `repro_socket_${Date.now().toString(36)}`.slice(0, 24);
    await signup(name, 'Passw0rd!123');

    const socket = getArenaSocket();
    const outcome = await waitForOutcome(socket);

    expect(outcome.ok).toBe(true);
    expect(socket.connected).toBe(true);
  });

  it('a socket with no credentials at all is rejected by the server, not silently accepted', async () => {
    // Deliberately bypass the real getArenaSocket() (which always attaches whatever
    // credential is available) to prove the server-side io.use() middleware itself still
    // enforces authentication — point 20's "no login bypass" requirement, applied to the
    // realtime transport specifically.
    const { io } = await import('socket.io-client');
    const socket = io(window.location.origin, { transports: ['websocket', 'polling'] });
    const outcome = await waitForOutcome(socket);
    socket.disconnect();

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toBe('Unauthorized');
  });
});
