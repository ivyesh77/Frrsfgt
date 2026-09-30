import { io, type Socket } from 'socket.io-client';
import { getBearerToken } from './api';

let socket: Socket | null = null;

/**
 * Lazily creates a single shared Socket.IO connection, on the SAME origin
 * the page was served from (Vite's dev-server proxy — see vite.config.ts —
 * forwards `/socket.io` to the arcade backend). The caller (useArena.ts) only
 * ever calls this AFTER a real login/session bootstrap has succeeded — the
 * server's io.use() middleware authenticates every connection.
 *
 * Two transports are offered, exactly mirroring api.ts: the httpOnly session cookie
 * (`withCredentials: true` attaches it automatically when the browser's cookie policy
 * allows it) AND the in-memory bearer token via Socket.IO's own `auth` payload — a
 * function, so it is re-evaluated on every (re)connection attempt rather than captured
 * once at socket-construction time. The token exists specifically because this sandbox's
 * live-preview tunnel embeds the app in a cross-site iframe, where some browsers block
 * third-party cookies outright regardless of any cookie attribute — the `auth` payload
 * isn't a cookie at all, so it is never subject to that policy. A real, non-iframed
 * deployment keeps working purely on the cookie exactly as before.
 */
export function getArenaSocket(): Socket {
  if (!socket) {
    socket = io({
      autoConnect: true,
      transports: ['websocket', 'polling'],
      withCredentials: true,
      auth: (cb) => cb({ token: getBearerToken() }),
    });
  }
  return socket;
}

export function disconnectArenaSocket(): void {
  socket?.disconnect();
  socket = null;
}
