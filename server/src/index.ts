import cookieParser from 'cookie-parser';
import cors from 'cors';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { createServer } from 'node:http';
import { nanoid } from 'nanoid';
import { Server, type Socket } from 'socket.io';
import { createSession, destroySession, resolveSession, SESSION_TTL_MS } from './auth.js';
import { GAME_KIND_LABELS } from './gameKinds/index.js';
import { checkRateLimit } from './rateLimit.js';
import { RoomAuthorizationError, RoomManager, InsufficientFundsError } from './rooms.js';
import { getUser } from './store.js';
import { SessionStoreUnavailableError } from './sessionStore.js';
import { ENTRY_FEE_TIERS, GAME_KINDS, ROOM_FORMATS, type GameKind, type RoomFormat } from './types.js';
import {
  AccountSuspendedError,
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
import { startAdminServer } from './admin/server.js';
import { appendLoginAttempt } from './admin/store.js';
import { getEffectiveFlags } from './admin/flags.js';
import { isUnderMaintenance, getMaintenanceMessage } from './admin/maintenance.js';
import { recordEvent } from './admin/signals.js';

import { createPlayerTicket, ticketForUser, ticketsForUser } from './admin/support.js';
import type { SupportTicketCategory } from './admin/types.js';
import { PaymentService } from './payments/service.js';
import { processProviderWebhook } from './payments/webhooks.js';
import { listPaymentMethodsForPlayer } from './payments/registry.js';
import { type PaymentCurrency, type PaymentMethod } from './payments/types.js';
import { getPlayerMatchDetail, getPlayerMatchHistory } from './playerHistory.js';
import { computeAchievements, computePlayerStats } from './playerStats.js';
import { listNotifications, markAllAsRead, markNotificationAsRead, unreadNotificationCount } from './notifications.js';

const PORT = Number(process.env.PORT) || 8787;
const ADMIN_PORT = Number(process.env.ADMIN_PORT) || 8788;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
// The Arena preview may be embedded where browsers block third-party cookies. Keep the
// server-validated bearer fallback enabled by default for that environment; a deployment
// that is guaranteed to be same-site can set AUTH_BEARER_FALLBACK=0 to keep credentials
// cookie-only.
const BEARER_FALLBACK_ENABLED = process.env.AUTH_BEARER_FALLBACK !== '0';
const SESSION_COOKIE = 'arena_session';

// Trust the configured number of reverse-proxy hops (e.g. a TLS-terminating load balancer
// or CDN in front of this process) so Express's own `req.secure`/`req.protocol` correctly
// reflect the ORIGINAL client request's scheme (from X-Forwarded-Proto), not the scheme of
// the final internal hop that actually reaches this process (which is very often plain HTTP
// once TLS has already been terminated upstream). Configurable per deployment — set to the
// exact number of trusted proxies in front of this process (0 if none, i.e. this process is
// itself directly internet-facing). Defaults to 1 (a single trusted edge proxy/tunnel),
// which is correct both for this sandbox's preview tunnel and for a typical single-LB
// production deployment; raise it if there is a chain of more than one trusted proxy.
const TRUSTED_PROXY_HOPS = Number(process.env.TRUSTED_PROXY_HOPS ?? 1);

const app = express();
app.set('trust proxy', TRUSTED_PROXY_HOPS);

// `credentials: true` is what makes the httpOnly session cookie usable for a genuinely
// cross-origin frontend. The normal player deployment is same-origin through Vite's proxy,
// so it needs no CORS header at all. If a separate frontend origin is deployed, it MUST be
// listed explicitly in ALLOWED_ORIGINS (comma-separated); an empty list means same-origin
// only. Never reflect an arbitrary Origin while credentials are enabled.
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
const corsOrigin = allowedOrigins.length > 0 ? allowedOrigins : false;
app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
  }),
);
// Baseline security headers on every response. This API never serves HTML, so these are
// defense-in-depth (they also protect anyone who navigates to an endpoint directly), and
// HSTS is only ever sent when the request actually arrived over HTTPS (checked via
// trust-proxy-aware req.secure) — telling a plain-HTTP client to force-upgrade to a TLS
// endpoint that may not exist yet would break local/dev access rather than secure it.
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  if (IS_PRODUCTION || req.secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
});

app.use(express.json({
  limit: '1mb',
  verify: (req, _res, buffer) => {
    (req as Request).rawBody = buffer.toString('utf8');
  },
}));
app.use(cookieParser());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  // Same explicit allowlist as REST. Same-origin Vite proxy traffic does not need a CORS
  // response, while a separately hosted frontend must be configured deliberately.
  cors: { origin: corsOrigin, credentials: true },
});

const roomManager = new RoomManager(io);

// ---------------------------------------------------------------------------
// Auth plumbing. `requireAuth` is the ONLY thing ever allowed to set `req.userId`, and it
// only ever does so from a verified session token read from an httpOnly cookie — never
// from anything in the request body/params/query. Every sensitive route below reads
// `req.userId`, never `req.body.userId` or `req.params.userId`.
// ---------------------------------------------------------------------------
function setSessionCookie(res: Response, token: string, req: Request): void {
  // `secure` must reflect whether THIS request was actually HTTPS, not a hardcoded
  // assumption — browsers silently refuse to store a `Secure` cookie at all when the
  // response arrived over plain HTTP, which would otherwise make local development over
  // plain `http://localhost` (no tunnel in front of it) look like login succeeded (the
  // response body still carries the token, so the app still works via the bearer-token
  // fallback) while silently never actually persisting the cookie. `req.secure` is correct
  // here specifically because `trust proxy` is configured above, so it already accounts for
  // `X-Forwarded-Proto` from a trusted edge proxy/tunnel — not just this process's own
  // (often plain-HTTP, post-TLS-termination) socket.
  const isHttps = IS_PRODUCTION || req.secure;
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true, // never readable by JS — closes the "identity stored as plain JS-readable localStorage" gap
    // CSRF defense: with a real same-site production deployment this stays 'lax' exactly as
    // documented in SECURITY_FIX_REPORT.md §F.4 — the cookie is then never attached to a
    // cross-site request at all, which is the actual protection. This sandbox's live-preview
    // tunnel, however, serves the app inside a cross-site iframe on a different top-level
    // origin (Arena's own UI embeds the preview URL) — under that origin, a 'lax' cookie is
    // NEVER sent on any fetch/XHR/WebSocket made from inside the iframe (only true
    // top-level navigations qualify for 'lax'), which silently broke every authenticated
    // action right after login/signup. 'none' is the only SameSite value browsers will
    // actually deliver in that embedded context, and it is only usable at all paired with
    // `secure: true`. This relaxation is scoped to non-production AND only when the request
    // genuinely was HTTPS; a real standalone deployment (its own domain, not
    // iframe-embedded) keeps the strict 'lax'/CSRF-safe behavior, and a plain local-HTTP dev
    // request (no tunnel at all) correctly falls back to 'lax'/non-secure so the cookie is
    // actually stored rather than silently dropped.
    sameSite: IS_PRODUCTION ? 'lax' : isHttps ? 'none' : 'lax',
    secure: isHttps,
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

// ---------------------------------------------------------------------------
// TEMPORARY auth diagnostics (point 15 of the session-expiry audit). Opt-in via
// AUTH_DEBUG=1 so it never spams production logs by default, but can be flipped on in
// this environment while the "Session Expired" report is being chased down. Logs ONLY:
// a per-request id, the endpoint, which credential transport was present (boolean, never
// the value), whether auth succeeded, and — on failure — a specific machine-readable
// reason (missing/expired/invalid/mismatched-env). NEVER logs the password, the session
// token/cookie value, or anything else that would let a log reader impersonate a session.
// Remove this block (and its two call sites below) once the real root cause is found.
// ---------------------------------------------------------------------------
const AUTH_DEBUG = process.env.AUTH_DEBUG === '1';
let authDebugCounter = 0;

interface AuthDebugInfo {
  reqId: string;
  endpoint: string;
  hadBearer: boolean;
  hadCookie: boolean;
  origin: string | undefined;
  result: 'authenticated' | 'unauthenticated' | 'success';
  reason?: string;
}

function logAuthEvent(info: AuthDebugInfo): void {
  if (!AUTH_DEBUG) return;
  // eslint-disable-next-line no-console
  console.log(
    `[auth-debug] #${info.reqId} ${info.endpoint} origin=${info.origin ?? 'none'} bearer=${info.hadBearer} cookie=${info.hadCookie} -> ${info.result}${info.reason ? ` (${info.reason})` : ''}`,
  );
}

function requestBearerToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice('Bearer '.length);
  const fallbackHeader = req.headers['x-arena-session-token'];
  return typeof fallbackHeader === 'string' ? fallbackHeader : undefined;
}

function invalidateRequestSessions(req: Request): void {
  const bearerToken = requestBearerToken(req);
  const cookieToken = req.cookies?.[SESSION_COOKIE] as string | undefined;
  // Login/signup rotate the browser's current session. This matters when a stale valid
  // cookie remains in an embedded preview while the auth response issues a new bearer
  // token: leaving both live would make the next /me request look like two different users.
  destroySession(bearerToken);
  if (cookieToken !== bearerToken) destroySession(cookieToken);
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  // The httpOnly cookie is the primary browser credential. The explicit bearer token is an
  // additive fallback because this sandbox's live-preview tunnel can embed the app in a
  // cross-site iframe where some browsers block third-party cookies regardless of
  // SameSite/Secure. Both transports carry the same opaque, server-issued token; neither is
  // a client-asserted identity. If both are present, they must resolve to the same user.
  const bearerToken = requestBearerToken(req);
  const cookieToken = req.cookies?.[SESSION_COOKIE] as string | undefined;
  const bearerUserId = resolveSession(bearerToken);
  const cookieUserId = bearerToken && cookieToken === bearerToken ? bearerUserId : resolveSession(cookieToken);
  const credentialsMismatch = Boolean(bearerUserId && cookieUserId && bearerUserId !== cookieUserId);
  // The cookie is the primary browser credential; bearer is only a fallback for preview
  // environments that block third-party cookies. If both are present they must resolve to
  // the same account — never let a stale bearer token silently override a valid cookie, and
  // never accept two concurrent browser identities as one request.
  const userId = credentialsMismatch ? null : cookieUserId ?? bearerUserId;
  const reqId = `r${++authDebugCounter}`;
  if (!userId) {
    logAuthEvent({
      reqId,
      endpoint: `${req.method} ${req.path}`,
      hadBearer: Boolean(bearerToken),
      hadCookie: Boolean(cookieToken),
      origin: req.headers.origin,
      result: 'unauthenticated',
      reason: credentialsMismatch ? 'credential-mismatch' : !bearerToken && !cookieToken ? 'no-credential-presented' : 'token-not-found-or-expired',
    });
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  logAuthEvent({
    reqId,
    endpoint: `${req.method} ${req.path}`,
    hadBearer: Boolean(bearerToken),
    hadCookie: Boolean(cookieToken),
    origin: req.headers.origin,
    result: 'authenticated',
  });
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
const paymentStatusLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false, handler: jsonRateLimitHandler });
const paymentWebhookLimiter = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false, handler: jsonRateLimitHandler });
const walletReadLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false, handler: jsonRateLimitHandler });

const paymentService = new PaymentService();

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, gameKinds: GAME_KINDS, entryFees: ENTRY_FEE_TIERS, formats: ROOM_FORMATS });
});

// ---------------------------------------------------------------------------
// Payments: the player may request a payment, but only this service can route, call an
// adapter, accept a verified provider event, and settle the existing wallet ledger.
// ---------------------------------------------------------------------------
app.get('/api/payments/methods', requireAuth, paymentStatusLimiter, (_req, res) => {
  res.json({ methods: listPaymentMethodsForPlayer(), note: 'Only TEST/SANDBOX adapters are exposed in this build; no real money is accepted.' });
});

app.post('/api/payments/webhooks/:provider', paymentWebhookLimiter, async (req, res) => {
  const rawBody = req.rawBody ?? JSON.stringify(req.body ?? {});
  const signature = typeof req.headers['x-payment-signature'] === 'string' ? req.headers['x-payment-signature'] : undefined;
  try {
    const result = await processProviderWebhook(req.params.provider ?? '', rawBody, signature);
    res.status(result.duplicate ? 200 : 202).json({ ok: true, duplicate: result.duplicate, eventId: result.eventId, message: result.message });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Webhook rejected';
    const status = message.includes('signature') ? 401 : message.includes('not found') ? 404 : 400;
    res.status(status).json({ error: message });
  }
});

app.post('/api/payments/deposits', requireAuth, walletWriteLimiter, async (req, res) => {
  const requestId = typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : nanoid(12);
  const idempotencyKey = typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : req.body?.idempotencyKey;
  try {
    const transaction = await paymentService.createDeposit(req.userId!, { amount: Number(req.body?.amount), method: String(req.body?.method ?? '').toUpperCase() as PaymentMethod, currency: String(req.body?.currency ?? '').toUpperCase() as PaymentCurrency, idempotencyKey: typeof idempotencyKey === 'string' ? idempotencyKey : '', asset: typeof req.body?.asset === 'string' ? req.body.asset : undefined, network: typeof req.body?.network === 'string' ? req.body.network : undefined, requestId });
    res.status(201).json({ transaction });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Deposit request failed' });
  }
});

app.post('/api/payments/withdrawals', requireAuth, walletWriteLimiter, async (req, res) => {
  const requestId = typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : nanoid(12);
  const idempotencyKey = typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : req.body?.idempotencyKey;
  try {
    const transaction = await paymentService.createWithdrawal(req.userId!, { amount: Number(req.body?.amount), method: String(req.body?.method ?? '').toUpperCase() as PaymentMethod, currency: String(req.body?.currency ?? '').toUpperCase() as PaymentCurrency, idempotencyKey: typeof idempotencyKey === 'string' ? idempotencyKey : '', destination: typeof req.body?.destination === 'string' ? req.body.destination : '', asset: typeof req.body?.asset === 'string' ? req.body.asset : undefined, network: typeof req.body?.network === 'string' ? req.body.network : undefined, requestId });
    res.status(201).json({ transaction });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Withdrawal request failed' });
  }
});

app.get('/api/payments/transactions', requireAuth, paymentStatusLimiter, (req, res) => {
  const operation = req.query.operation === 'DEPOSIT' || req.query.operation === 'WITHDRAWAL' ? req.query.operation : undefined;
  res.json({ transactions: paymentService.listPlayerTransactions(req.userId!, operation) });
});

app.get('/api/payments/transactions/:id', requireAuth, paymentStatusLimiter, async (req, res) => {
  try {
    res.json({ transaction: await paymentService.getPlayerTransaction(req.userId!, req.params.id ?? '') });
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : 'Payment transaction not found' });
  }
});

// ---------------------------------------------------------------------------
// REST: auth
// ---------------------------------------------------------------------------
app.post('/api/auth/signup', signupLimiter, async (req, res) => {
  if (isUnderMaintenance('platform')) return res.status(503).json({ error: getMaintenanceMessage('platform') });
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!name || name.length < 2) return res.status(400).json({ error: 'Name must be at least 2 characters' });
  if (!password) return res.status(400).json({ error: 'Password is required' });

  try {
    const user = await registerUser(name, password);
    invalidateRequestSessions(req);
    const { token } = createSession(user.id);
    setSessionCookie(res, token, req);
    appendLoginAttempt({ id: nanoid(10), actor: 'player', usernameAttempted: name, success: true, timestamp: Date.now(), ip: req.ip ?? 'unknown' });
    logAuthEvent({ reqId: `r${++authDebugCounter}`, endpoint: 'POST /api/auth/signup', hadBearer: false, hadCookie: false, origin: req.headers.origin, result: 'success' });
    // The preview is embedded in a cross-site iframe, so cookie blocking is possible even
    // when the API itself is configured for production-like HTTPS. Return the same opaque,
    // server-issued token as an explicit fallback transport in every environment; the
    // client stores it only in sessionStorage and every use is still checked by /me.
    // It is never a userId/username/role assertion or a permanent identity cache.
    res.json(BEARER_FALLBACK_ENABLED ? { user: toPublicUser(user), token } : { user: toPublicUser(user) });
  } catch (err) {
    if (err instanceof UsernameTakenError) return res.status(409).json({ error: err.message });
    if (err instanceof SessionStoreUnavailableError) return res.status(503).json({ error: 'Authentication service unavailable' });
    res.status(400).json({ error: err instanceof Error ? err.message : 'Sign up failed' });
  }
});

app.post('/api/auth/login', loginLimiter, async (req, res) => {
  if (isUnderMaintenance('platform')) return res.status(503).json({ error: getMaintenanceMessage('platform') });
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!name || !password) return res.status(400).json({ error: 'Name and password are required' });

  try {
    const user = await authenticateUser(name, password);
    invalidateRequestSessions(req);
    const { token } = createSession(user.id);
    setSessionCookie(res, token, req);
    appendLoginAttempt({ id: nanoid(10), actor: 'player', usernameAttempted: name, success: true, timestamp: Date.now(), ip: req.ip ?? 'unknown' });
    logAuthEvent({ reqId: `r${++authDebugCounter}`, endpoint: 'POST /api/auth/login', hadBearer: false, hadCookie: false, origin: req.headers.origin, result: 'success' });
    res.json(BEARER_FALLBACK_ENABLED ? { user: toPublicUser(user), token } : { user: toPublicUser(user) });
  } catch (err) {
    appendLoginAttempt({ id: nanoid(10), actor: 'player', usernameAttempted: name, success: false, timestamp: Date.now(), ip: req.ip ?? 'unknown' });
    logAuthEvent({
      reqId: `r${++authDebugCounter}`,
      endpoint: 'POST /api/auth/login',
      hadBearer: false,
      hadCookie: false,
      origin: req.headers.origin,
      result: 'unauthenticated',
      reason: err instanceof InvalidCredentialsError ? 'bad-credentials' : err instanceof AccountSuspendedError ? 'account-suspended' : 'bad-request',
    });
    if (err instanceof InvalidCredentialsError) return res.status(401).json({ error: err.message });
    if (err instanceof AccountSuspendedError) return res.status(403).json({ error: err.message });
    if (err instanceof SessionStoreUnavailableError) return res.status(503).json({ error: 'Authentication service unavailable' });
    res.status(400).json({ error: err instanceof Error ? err.message : 'Log in failed' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  const bearerToken = requestBearerToken(req);
  const cookieToken = req.cookies?.[SESSION_COOKIE] as string | undefined;
  // In a browser both transports may be present. Invalidate both exact server-side session
  // records so a stale cookie or bearer copy cannot revive the account after logout.
  invalidateRequestSessions(req);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  logAuthEvent({
    reqId: `r${++authDebugCounter}`,
    endpoint: 'POST /api/auth/logout',
    hadBearer: Boolean(bearerToken),
    hadCookie: Boolean(cookieToken),
    origin: req.headers.origin,
    result: 'success',
  });
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
  if (isUnderMaintenance('wallet') || isUnderMaintenance('deposit')) return res.status(503).json({ error: getMaintenanceMessage('deposit') });
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
  if (isUnderMaintenance('wallet') || isUnderMaintenance('withdraw')) return res.status(503).json({ error: getMaintenanceMessage('withdraw') });
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

// Which room formats are actually offered right now — real server config (feature flags),
// never a client-invented list. Public (no auth needed) since the mode-select screen is
// shown before a player necessarily has a live session resolved yet.
app.get('/api/game-modes', (_req, res) => {
  const flags = getEffectiveFlags();
  const modes = ROOM_FORMATS.map((f) => ({ ...f, enabled: f.id === 'duel' ? flags.duelEnabled : f.id === 'squad' ? flags.squadEnabled : false }));
  res.json({ modes, entryFees: ENTRY_FEE_TIERS });
});

// ---------------------------------------------------------------------------
// REST: match history + stats + achievements — all read-only, all derived from the same
// real, already-stored match-history ledger and wallet transactions every other part of
// this system uses (see playerHistory.ts / playerStats.ts doc-comments). Every route
// below derives the account from `req.userId` only, same IDOR-closed pattern as wallet.
// ---------------------------------------------------------------------------
app.get('/api/match-history', requireAuth, walletReadLimiter, (req, res) => {
  const page = Number(req.query.page) || 1;
  const pageSize = Number(req.query.pageSize) || 10;
  const format = typeof req.query.format === 'string' ? (req.query.format as RoomFormat | 'all') : 'all';
  const outcome = typeof req.query.outcome === 'string' ? (req.query.outcome as 'win' | 'loss' | 'draw' | 'void' | 'all') : 'all';
  res.json(getPlayerMatchHistory(req.userId!, { page, pageSize, format, outcome }));
});

app.get('/api/match-history/:roomId', requireAuth, walletReadLimiter, (req, res) => {
  const detail = getPlayerMatchDetail(req.userId!, req.params.roomId ?? '');
  if (!detail) return res.status(404).json({ error: 'Match not found' });
  res.json({ match: detail });
});

app.get('/api/stats', requireAuth, walletReadLimiter, (req, res) => {
  res.json({ stats: computePlayerStats(req.userId!) });
});

app.get('/api/achievements', requireAuth, walletReadLimiter, (req, res) => {
  res.json({ achievements: computeAchievements(req.userId!) });
});

// ---------------------------------------------------------------------------
// REST: notifications — real events only (see notifications.ts). A player can only ever
// read or mark-read their OWN notifications; every function below takes req.userId, never
// a notification owner read from the request.
// ---------------------------------------------------------------------------
app.get('/api/notifications', requireAuth, walletReadLimiter, (req, res) => {
  const page = Number(req.query.page) || 1;
  const pageSize = Number(req.query.pageSize) || 20;
  res.json(listNotifications(req.userId!, page, pageSize));
});

app.get('/api/notifications/unread-count', requireAuth, walletReadLimiter, (req, res) => {
  res.json({ unreadCount: unreadNotificationCount(req.userId!) });
});

app.post('/api/notifications/:id/read', requireAuth, walletWriteLimiter, (req, res) => {
  const entry = markNotificationAsRead(req.userId!, req.params.id ?? '');
  if (!entry) return res.status(404).json({ error: 'Notification not found' });
  res.json({ ok: true, notification: entry });
});

app.post('/api/notifications/read-all', requireAuth, walletWriteLimiter, (req, res) => {
  const count = markAllAsRead(req.userId!);
  res.json({ ok: true, markedCount: count });
});

// ---------------------------------------------------------------------------
// REST: payment methods (public-safe config only, see publicPaymentMethodsView) + support
// tickets. A player can create and read only their OWN tickets — never another user's,
// never an admin-only field (internal notes, which admin handled it, etc).
// ---------------------------------------------------------------------------
app.get('/api/payment-methods', requireAuth, walletReadLimiter, (_req, res) => {
  const methods = listPaymentMethodsForPlayer();
  const upi = methods.find((method) => method.method === 'UPI');
  res.json({
    demoWallet: { available: true, note: 'Instant demo-currency deposits/withdrawals — practice coins only, never real money.' },
    methods,
    upi: upi ? { enabled: upi.depositEnabled || upi.withdrawalEnabled, minAmount: upi.minAmount, maxAmount: upi.maxAmount } : { enabled: false, minAmount: 0, maxAmount: 0 },
    crypto: methods.filter((method) => method.method === 'CRYPTO').map((method) => ({ asset: method.asset ?? 'unknown', network: method.network ?? 'unknown', depositEnabled: method.depositEnabled, withdrawEnabled: method.withdrawalEnabled, minAmount: method.minAmount, maxAmount: method.maxAmount, confirmationsRequired: 0 })),
  });
});

const SUPPORT_CATEGORIES: SupportTicketCategory[] = ['account', 'wallet', 'payment', 'gameplay', 'other'];

app.get('/api/support/tickets', requireAuth, walletReadLimiter, (req, res) => {
  res.json({ tickets: ticketsForUser(req.userId!) });
});

app.get('/api/support/tickets/:id', requireAuth, walletReadLimiter, (req, res) => {
  const ticket = ticketForUser(req.userId!, req.params.id ?? '');
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  res.json({ ticket });
});

app.post('/api/support/tickets', requireAuth, walletWriteLimiter, (req, res) => {
  const user = getUser(req.userId!);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const subject = typeof req.body?.subject === 'string' ? req.body.subject.trim() : '';
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  const categoryRaw = typeof req.body?.category === 'string' ? req.body.category : 'other';
  const category = SUPPORT_CATEGORIES.includes(categoryRaw as SupportTicketCategory) ? (categoryRaw as SupportTicketCategory) : 'other';
  if (!subject || subject.length < 3) return res.status(400).json({ error: 'Please enter a short subject (at least 3 characters)' });
  if (!message || message.length < 10) return res.status(400).json({ error: 'Please describe the issue in a bit more detail (at least 10 characters)' });
  const ticket = createPlayerTicket(user.id, user.name, subject, message, category);
  res.json({ ok: true, ticket });
});

// ---------------------------------------------------------------------------
// Socket.IO: live rooms + matches. Every socket must authenticate during the handshake —
// `socket.data.userId` is resolved once, here, from the same session cookie the REST API
// uses, and every handler below uses ONLY `socket.data.userId`, never a userId read from
// the event payload. A malicious client cannot substitute another player's id because
// there is no id field left for it to substitute.
// ---------------------------------------------------------------------------
io.use((socket, next) => {
  // Same dual transport as requireAuth() above: the session cookie is primary and the
  // Socket.IO auth token is a fallback for cookie-blocked previews. Both resolve through
  // the identical server-side session lookup, and when both exist they must match. There
  // is still no client-supplied userId anywhere in this handshake.
  const authToken = typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : undefined;
  const cookieHeader = socket.handshake.headers.cookie;
  const cookieToken = cookieHeader
    ?.split(';')
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  const decodedCookieToken = cookieToken ? decodeURIComponent(cookieToken) : undefined;
  const bearerUserId = resolveSession(authToken);
  const cookieUserId = authToken && decodedCookieToken === authToken ? bearerUserId : resolveSession(decodedCookieToken);
  const credentialsMismatch = Boolean(bearerUserId && cookieUserId && bearerUserId !== cookieUserId);
  const userId = credentialsMismatch ? null : cookieUserId ?? bearerUserId;
  const reqId = `s${++authDebugCounter}`;
  if (!userId) {
    logAuthEvent({
      reqId,
      endpoint: 'SOCKET handshake',
      hadBearer: Boolean(authToken),
      hadCookie: Boolean(cookieToken),
      origin: socket.handshake.headers.origin,
      result: 'unauthenticated',
      reason: credentialsMismatch ? 'credential-mismatch' : !authToken && !cookieToken ? 'no-credential-presented' : 'token-not-found-or-expired',
    });
    next(new Error('Unauthorized'));
    return;
  }
  logAuthEvent({
    reqId,
    endpoint: 'SOCKET handshake',
    hadBearer: Boolean(authToken),
    hadCookie: Boolean(cookieToken),
    origin: socket.handshake.headers.origin,
    result: 'authenticated',
  });
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
      if (isUnderMaintenance('matchmaking') || isUnderMaintenance('game')) throw new Error(getMaintenanceMessage('matchmaking'));
      if (!GAME_KINDS.includes(payload?.gameKind)) throw new Error('Invalid game kind');
      if (!ENTRY_FEE_TIERS.includes(payload?.entryFee as (typeof ENTRY_FEE_TIERS)[number])) {
        throw new Error('Invalid entry fee tier');
      }
      if (!ROOM_FORMATS.some((f) => f.id === payload?.format)) throw new Error('Invalid room format');
      const flags = getEffectiveFlags();
      if (payload?.format === 'duel' && !flags.duelEnabled) throw new Error('1v1 Duel is temporarily disabled');
      if (payload?.format === 'squad' && !flags.squadEnabled) throw new Error('1v1v1v1 Squad is temporarily disabled');
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
      if (socketRateLimited(socket, 'match:answer', 60, 10_000)) {
        recordEvent('answerRateLimited', userId);
        throw new Error('Too many answers submitted — slow down');
      }
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

// The admin operations center is a genuinely SEPARATE Express app on its own,
// independently configurable port (ADMIN_PORT, default 8788) — never mounted on the same
// router as the player-facing API, and never reachable through it. It is started here (in
// the same Node process as the player server, sharing the exact same `roomManager`/`io`
// instances by direct reference) so every admin read reflects the real, live backend state
// instead of a second, potentially-divergent copy of it — see admin/server.ts's own
// doc-comment for the full reasoning. Set ADMIN_ALLOWED_ORIGIN to the admin web app's
// actual origin before deploying this anywhere reachable by the public internet.
const adminServer = startAdminServer({ roomManager, io }, ADMIN_PORT);

export { app, httpServer, io, PORT, ADMIN_PORT, adminServer };
