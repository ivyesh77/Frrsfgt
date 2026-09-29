import cors from 'cors';
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { GAME_KIND_LABELS } from './gameKinds/index.js';
import { RoomManager, InsufficientFundsError } from './rooms.js';
import { findUserByName, getUser } from './store.js';
import { ENTRY_FEE_TIERS, GAME_KINDS, type GameKind } from './types.js';
import { createGuestUser, recentTransactions, topUp } from './wallet.js';

const PORT = Number(process.env.PORT) || 8787;

const app = express();
app.use(cors({ origin: true, credentials: false }));
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: true },
});

const roomManager = new RoomManager(io);

// ---------------------------------------------------------------------------
// REST: auth + wallet (kept simple/guest-based; a real payment gateway and
// authenticated accounts can replace this layer without touching game logic)
// ---------------------------------------------------------------------------
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, gameKinds: GAME_KINDS, entryFees: ENTRY_FEE_TIERS });
});

app.post('/api/auth/guest', (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const mode = req.body?.mode === 'login' || req.body?.mode === 'signup' ? req.body.mode : undefined;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (name.length < 2) return res.status(400).json({ error: 'Name must be at least 2 characters' });

  const existing = findUserByName(name);

  if (mode === 'login') {
    if (!existing) {
      return res.status(404).json({ error: 'No account found with that name. Try signing up instead.' });
    }
    return res.json({ user: existing });
  }

  if (mode === 'signup') {
    if (existing) {
      return res.status(409).json({ error: 'That name is already taken. Try logging in instead.' });
    }
    return res.json({ user: createGuestUser(name) });
  }

  // No mode specified (e.g. the silent auto-login from a stored identity) — keep legacy find-or-create behavior.
  const user = existing ?? createGuestUser(name);
  res.json({ user });
});

app.get('/api/wallet/:userId', (req, res) => {
  const user = getUser(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user, transactions: recentTransactions(user.id) });
});

app.post('/api/wallet/:userId/topup', (req, res) => {
  const amount = Number(req.body?.amount);
  try {
    const user = topUp(req.params.userId, amount);
    res.json({ user });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Top-up failed' });
  }
});

app.get('/api/rooms', (req, res) => {
  const gameKind = req.query.gameKind as GameKind | undefined;
  res.json({ rooms: roomManager.listRooms(gameKind), labels: GAME_KIND_LABELS });
});

// ---------------------------------------------------------------------------
// Socket.IO: live rooms + matches
// ---------------------------------------------------------------------------
const socketSessions = new Map<string, { userId: string; roomId: string }>();

io.on('connection', (socket) => {
  socket.on('rooms:create', (payload: { gameKind: GameKind; entryFee: number }, ack) => {
    try {
      if (!GAME_KINDS.includes(payload.gameKind)) throw new Error('Invalid game kind');
      if (!ENTRY_FEE_TIERS.includes(payload.entryFee as (typeof ENTRY_FEE_TIERS)[number])) {
        throw new Error('Invalid entry fee tier');
      }
      const room = roomManager.createRoom(payload.gameKind, payload.entryFee);
      ack?.({ ok: true, roomId: room.id });
    } catch (err) {
      ack?.({ ok: false, error: err instanceof Error ? err.message : 'Failed to create room' });
    }
  });

  socket.on('rooms:join', (payload: { userId: string; roomId: string }, ack) => {
    try {
      const user = getUser(payload.userId);
      if (!user) throw new Error('Unknown user');
      const room = roomManager.joinRoom(payload.roomId, user, socket.id);
      socket.join(room.id);
      socketSessions.set(socket.id, { userId: user.id, roomId: room.id });
      ack?.({ ok: true, room: roomManager.getRoomPublic(room.id) });
    } catch (err) {
      const message =
        err instanceof InsufficientFundsError ? 'Insufficient wallet balance for this room' : (err as Error).message;
      ack?.({ ok: false, error: message });
    }
  });

  socket.on('rooms:leave', (payload: { userId: string; roomId: string }, ack) => {
    roomManager.leaveRoom(payload.roomId, payload.userId);
    socket.leave(payload.roomId);
    socketSessions.delete(socket.id);
    ack?.({ ok: true });
  });

  socket.on('rooms:ready', (payload: { userId: string; roomId: string }, ack) => {
    roomManager.setReady(payload.roomId, payload.userId);
    ack?.({ ok: true });
  });

  socket.on(
    'match:answer',
    (payload: { userId: string; roomId: string; questionId: string; choiceIndex: number }, ack) => {
      try {
        const result = roomManager.submitAnswer(payload.roomId, payload.userId, payload.questionId, payload.choiceIndex);
        ack?.({ ok: true, ...result });
      } catch (err) {
        ack?.({ ok: false, error: err instanceof Error ? err.message : 'Failed to submit answer' });
      }
    },
  );

  socket.on('disconnect', () => {
    const session = socketSessions.get(socket.id);
    if (session) {
      roomManager.handleDisconnect(session.roomId, session.userId, socket.id);
      socketSessions.delete(socket.id);
    }
  });
});

httpServer.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Memory Match arcade server listening on :${PORT}`);
});

export { app, httpServer, io, PORT };
