import cookieParser from 'cookie-parser';
import cors from 'cors';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { createServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { createSession, destroySession, resolveSession, SESSION_TTL_MS } from './auth.js';
import { GAME_KIND_LABELS } from './gameKinds/index.js';
import { checkRateLimit } from './rateLimit.js';
import { RoomAuthorizationError, RoomManager, InsufficientFundsError } from './rooms.js';
import { getUser } from './store.js';
import { ENTRY_FEE_TIERS, GAME_KINDS, ROOM_FORMATS, type GameKind, type RoomFormat } from './types.js';
import {
  InvalidCredentialsError,
  UsernameTakenError,
  authenticateUser,
  getWalletStats,
  recentTransactions,
  registerUser,
  toPublicUser,
  topUp,
  withdraw,
} from './wallet.js';

const PORT = Number(process.env.PORT) || 8787;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const SESSION_COOKIE = 'arena_session';

const app = express();
// `credentials: true` + reflecting the request origin (rather than a literal "*") is what
// makes the httpOnly session cookie usable at all — browsers refuse to send credentialed
// requests to a wildcard-CORS origin. The actual cross-site forgery defense is the
// cookie's own `sameSite: 'lax'` attribute set below (see setSessionCookie), not this CORS
// policy — see AUDIT_REPORT.md / SECURITY_REPORT.md for the full reasoning.
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: true, credentials: true },
});

const roomManager = new RoomManager(io);

// ---------------------------------------------------------------------------
// Auth plumbing. `requireAuth` is the ONLY thing ever allowed to set `req.userId`, and it
// only ever does so from a verified session token read from an httpOnly cookie — never
// from anything in the request body/params/query. Every sensitive route below reads
// `req.userId`, never `req.body.userId` or `req.params.userId`.
// ---------------------------------------------------------------------------
function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true, // never readable by JS — closes the "identity stored as plain JS-readable localStorage" gap
    sameSite: 'lax', // the actual CSRF defense: never attached to a cross-site POST/fetch
    secure: IS_PRODUCTION, // HTTPS-only once actually deployed behind TLS; relaxed for local http dev
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  const userId = resolveSession(token);
  if (!userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  req.userId = userId;
  next();
}

// Auth endpoints get their own limiters, kept separate (rather than one shared budget)
// so a burst of new signups from one IP (e.g. an internet cafe, campus NAT, or — in this
// codebase's own test suite — many accounts created back-to-back) can't itself lock out
// that IP's ability to log in. Login is the more valuable route to guard tightly since
// it's the only remaining path for brute-forcing a specific password now that "login"
// actually requires one (see AUDIT_REPORT.md's prior "login by name alone" account-
// takeover finding, which this whole auth system replaces). Both are IP-keyed, which is a
// known, disclosed limitation against a distributed (many-IP) attacker — see the final
// security report.
// Every limiter returns the same JSON error shape as the rest of the API (never the
// package's default plain-text body) so a client never has to special-case a 429.
function jsonRateLimitHandler(_req: Request, res: Response): void {
  res.status(429).json({ error: 'Too many requests — please slow down and try again shortly' });
}
// Limits are overridable via env purely so the self-test suite (which legitimately creates
// far more than 30 throwaway accounts per run from one IP) doesn't trip its own rate limit —
// production never sets these env vars and always gets the real 30/15 limits below.
const signupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.ARCADE_SIGNUP_LIMIT) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler,
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.ARCADE_LOGIN_LIMIT) || 15,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler,
});
// Financial mutations get a stricter limiter than ordinary reads.
const walletWriteLimiter = rateLimit({ windowMs: 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, handler: jsonRateLimitHandler });
const walletReadLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false, handler: jsonRateLimitHandler });

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, gameKinds: GAME_KINDS, entryFees: ENTRY_FEE_TIERS, formats: ROOM_FORMATS });
});

// ---------------------------------------------------------------------------
// REST: auth
// ---------------------------------------------------------------------------
app.post('/api/auth/signup', signupLimiter, async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!name || name.length < 2) return res.status(400).json({ error: 'Name must be at least 2 characters' });
  if (!password) return res.status(400).json({ error: 'Password is required' });

  try {
    const user = await registerUser(name, password);
    const { token } = createSession(user.id);
    setSessionCookie(res, token);
    res.json({ user: toPublicUser(user) });
  } catch (err) {
    if (err instanceof UsernameTakenError) return res.status(409).json({ error: err.message });
    res.status(400).json({ error: err instanceof Error ? err.message : 'Sign up failed' });
  }
});

app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!name || !password) return res.status(400).json({ error: 'Name and password are required' });

  try {
    const user = await authenticateUser(name, password);
    const { token } = createSession(user.id);
    setSessionCookie(res, token);
    res.json({ user: toPublicUser(user) });
  } catch (err) {
    if (err instanceof InvalidCredentialsError) return res.status(401).json({ error: err.message });
    res.status(400).json({ error: err instanceof Error ? err.message : 'Log in failed' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  destroySession(token);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  const user = getUser(req.userId!);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ user: toPublicUser(user) });
});

// ---------------------------------------------------------------------------
// REST: wallet — every route below derives the account it operates on from `req.userId`
// (the authenticated session), NEVER from a `:userId` route param or request body field.
// This closes the audit's IDOR finding: there is no longer any "which account" value for
// a malicious client to swap out — the server decides that from the session alone.
// ---------------------------------------------------------------------------
app.get('/api/wallet', requireAuth, walletReadLimiter, (req, res) => {
  const user = getUser(req.userId!);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ user: toPublicUser(user), transactions: recentTransactions(user.id) });
});

app.get('/api/wallet/stats', requireAuth, walletReadLimiter, (req, res) => {
  const user = getUser(req.userId!);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ stats: getWalletStats(user.id) });
});

app.post('/api/wallet/topup', requireAuth, walletWriteLimiter, (req, res) => {
  const amount = Number(req.body?.amount);
  const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId : undefined;
  try {
    const user = topUp(req.userId!, amount, requestId);
    res.json({ user: toPublicUser(user) });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Top-up failed' });
  }
});

app.post('/api/wallet/withdraw', requireAuth, walletWriteLimiter, (req, res) => {
  const amount = Number(req.body?.amount);
  const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId : undefined;
  try {
    const user = withdraw(req.userId!, amount, requestId);
    res.json({ user: toPublicUser(user) });
  } catch (err) {
    const message = err instanceof InsufficientFundsError ? 'Insufficient wallet balance to withdraw that much' : (err as Error).message;
    res.status(400).json({ error: message });
  }
});

app.get('/api/rooms', (req, res) => {
  const gameKind = req.query.gameKind as GameKind | undefined;
  res.json({ rooms: roomManager.listRooms(gameKind), labels: GAME_KIND_LABELS });
});

// ---------------------------------------------------------------------------
// Socket.IO: live rooms + matches. Every socket must authenticate during the handshake —
// `socket.data.userId` is resolved once, here, from the same session cookie the REST API
// uses, and every handler below uses ONLY `socket.data.userId`, never a userId read from
// the event payload. A malicious client cannot substitute another player's id because
// there is no id field left for it to substitute.
// ---------------------------------------------------------------------------
io.use((socket, next) => {
  const cookieHeader = socket.handshake.headers.cookie;
  const token = cookieHeader
    ?.split(';')
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  const userId = resolveSession(token ? decodeURIComponent(token) : undefined);
  if (!userId) {
    next(new Error('Unauthorized'));
    return;
  }
  socket.data.userId = userId;
  next();
});

const socketSessions = new Map<string, { userId: string; roomId: string }>();

function socketRateLimited(socket: Socket, action: string, limit: number, windowMs: number): boolean {
  const allowed = checkRateLimit(`${socket.data.userId}:${action}`, limit, windowMs);
  return !allowed;
}

io.on('connection', (socket) => {
  const userId = socket.data.userId as string;

  // A page refresh / brief network drop / tab switch gets a brand-new Socket.IO connection
  // — this is the server silently resuming that player into whatever match they were
  // already authoritatively part of (if any), purely from server-side state. The client
  // never has to ask for this, and never gets to say *which* match to resume into.
  const resumedRoom = roomManager.reconnect(userId, socket.id);
  if (resumedRoom) {
    socket.join(resumedRoom.id);
    socketSessions.set(socket.id, { userId, roomId: resumedRoom.id });
  }

  // The only way into a match: ask to join the server-side matchmaking queue for a mode.
  // There is no room-id parameter here at all — the server alone decides which room (an
  // existing open one, or a freshly created one) this player lands in, which makes "join
  // an unauthorized/arbitrary match id" structurally impossible rather than merely checked.
  socket.on('queue:join', (payload: { gameKind: GameKind; entryFee: number; format: RoomFormat }, ack) => {
    try {
      if (socketRateLimited(socket, 'queue:join', 10, 60_000)) throw new Error('Too many matchmaking requests — slow down');
      if (!GAME_KINDS.includes(payload?.gameKind)) throw new Error('Invalid game kind');
      if (!ENTRY_FEE_TIERS.includes(payload?.entryFee as (typeof ENTRY_FEE_TIERS)[number])) {
        throw new Error('Invalid entry fee tier');
      }
      if (!ROOM_FORMATS.some((f) => f.id === payload?.format)) throw new Error('Invalid room format');
      const user = getUser(userId);
      if (!user) throw new Error('Unknown user');
      const room = roomManager.queueJoin(payload.gameKind, payload.entryFee, payload.format, user, socket.id);
      socket.join(room.id);
      socketSessions.set(socket.id, { userId, roomId: room.id });
      ack?.({ ok: true, roomId: room.id, room: roomManager.getRoomPublic(room.id, userId) });
    } catch (err) {
      const message =
        err instanceof InsufficientFundsError ? 'Insufficient wallet balance for this room' : (err as Error).message;
      ack?.({ ok: false, error: message });
    }
  });

  socket.on('queue:leave', (payload: { roomId: string }, ack) => {
    if (socketRateLimited(socket, 'queue:leave', 20, 60_000)) return ack?.({ ok: false, error: 'Slow down' });
    roomManager.leaveRoom(payload?.roomId, userId);
    socket.leave(payload?.roomId);
    socketSessions.delete(socket.id);
    ack?.({ ok: true });
  });

  socket.on('rooms:leave', (payload: { roomId: string }, ack) => {
    if (socketRateLimited(socket, 'rooms:leave', 20, 60_000)) return ack?.({ ok: false, error: 'Slow down' });
    roomManager.leaveRoom(payload?.roomId, userId);
    socket.leave(payload?.roomId);
    socketSessions.delete(socket.id);
    ack?.({ ok: true });
  });

  socket.on('rooms:ready', (payload: { roomId: string }, ack) => {
    if (socketRateLimited(socket, 'rooms:ready', 10, 10_000)) return ack?.({ ok: false, error: 'Slow down' });
    roomManager.setReady(payload?.roomId, userId);
    ack?.({ ok: true });
  });

  socket.on('match:answer', (payload: { roomId: string; roundId: string; optionToken: string }, ack) => {
    try {
      // Deliberately generous — legitimate pacing is already capped by the round's own
      // memorize/answer timing (see rooms.ts), this is just a backstop against a client
      // hammering the event handler itself (e.g. spamming stale/garbage round ids).
      if (socketRateLimited(socket, 'match:answer', 60, 10_000)) throw new Error('Too many answers submitted — slow down');
      const result = roomManager.submitAnswer(payload?.roomId, userId, payload?.roundId, payload?.optionToken);
      ack?.({ ok: true, ...result });
    } catch (err) {
      if (err instanceof RoomAuthorizationError) {
        // eslint-disable-next-line no-console
        console.warn(`Rejected match:answer from ${userId} in room ${payload?.roomId}: ${err.message}`);
      }
      ack?.({ ok: false, error: err instanceof Error ? err.message : 'Failed to submit answer' });
    }
  });

  // REMATCH sends a request to the server; the server alone decides whether a rematch can
  // be created (only from a match this exact user just finished) and re-runs them through
  // the same queue-join path as any other match — never a client-only/locally-fabricated room.
  socket.on('match:rematch', (_payload: unknown, ack) => {
    try {
      if (socketRateLimited(socket, 'match:rematch', 10, 60_000)) throw new Error('Too many rematch requests — slow down');
      const user = getUser(userId);
      if (!user) throw new Error('Unknown user');
      const room = roomManager.rematch(user, socket.id);
      socket.join(room.id);
      socketSessions.set(socket.id, { userId, roomId: room.id });
      ack?.({ ok: true, roomId: room.id, room: roomManager.getRoomPublic(room.id, userId) });
    } catch (err) {
      const message =
        err instanceof InsufficientFundsError ? 'Insufficient wallet balance for a rematch' : (err as Error).message;
      ack?.({ ok: false, error: message });
    }
  });

  socket.on('disconnect', () => {
    const session = socketSessions.get(socket.id);
    if (session) {
      roomManager.handleDisconnect(session.roomId, session.userId, socket.id);
      socketSessions.delete(socket.id);
    }
  });
});

// Catch-all error handler: never leak a stack trace or internal error detail to the
// client, regardless of environment — log server-side instead.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  // eslint-disable-next-line no-console
  console.error('Unhandled request error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

httpServer.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Memory Match arcade server listening on :${PORT}`);
});

export { app, httpServer, io, PORT };
