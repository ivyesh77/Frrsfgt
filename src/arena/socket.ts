import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;

/**
 * Lazily creates a single shared Socket.IO connection, on the SAME origin
 * the page was served from (Vite's dev-server proxy — see vite.config.ts —
 * forwards `/socket.io` to the arcade backend). Never connects until the
 * player actually enters the Arena flow.
 */
export function getArenaSocket(): Socket {
  if (!socket) {
    socket = io({
      autoConnect: true,
      transports: ['websocket', 'polling'],
    });
  }
  return socket;
}

export function disconnectArenaSocket(): void {
  socket?.disconnect();
  socket = null;
}
