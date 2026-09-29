import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;

/**
 * Lazily creates a single shared Socket.IO connection, on the SAME origin
 * the page was served from (Vite's dev-server proxy — see vite.config.ts —
 * forwards `/socket.io` to the arcade backend). The caller (useArena.ts) only
 * ever calls this AFTER a real login/session bootstrap has succeeded — the
 * server's io.use() middleware authenticates every connection from the same
 * httpOnly session cookie the REST API uses (`withCredentials: true` below is
 * what makes the browser actually attach that cookie to the handshake), and
 * rejects the connection outright if there is no valid session.
 */
export function getArenaSocket(): Socket {
  if (!socket) {
    socket = io({
      autoConnect: true,
      transports: ['websocket', 'polling'],
      withCredentials: true,
    });
  }
  return socket;
}

export function disconnectArenaSocket(): void {
  socket?.disconnect();
  socket = null;
}
