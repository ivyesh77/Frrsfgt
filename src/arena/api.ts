import type {
  Achievement,
  ArenaUser,
  GameModeMeta,
  MatchHistoryItem,
  NotificationEntry,
  PaginatedMatchHistory,
  PaginatedNotifications,
  PlayerPaymentTransaction,
  PlayerStats,
  PublicPaymentMethods,
  RoomSummary,
  SupportTicket,
  SupportTicketCategory,
  Transaction,
  WalletStats,
} from './types';

// ---------------------------------------------------------------------------
// Bearer-token fallback transport. The primary, preferred identity transport is still the
// httpOnly session cookie (`credentials: 'include'` below) — that remains completely
// unchanged and is all a real, non-iframed production deployment ever needs.
//
// This sandbox's live-preview tunnel, however, serves the app inside a cross-site iframe
// on a different top-level origin, and some browsers block ALL cookies set from inside a
// cross-site iframe outright (Safari ITP, Firefox ETP, and a growing share of Chrome) —
// not just a SameSite rule, a blanket "no third-party cookies at all" policy that no
// cookie attribute can opt back into working. An explicit bearer token the client attaches
// itself isn't a cookie at all, so it isn't subject to that policy either way.
//
// This token is mirrored into `sessionStorage` (NEVER `localStorage`) purely so a page
// refresh in the SAME tab doesn't look like a logout when the cookie path isn't available
// (see above) — this is the one concrete thing that previously made "log in, then refresh"
// behave inconsistently depending on exactly how the cookie handshake went. Mirroring to
// `sessionStorage` does not weaken authentication or create a fake logged-in state: it is
// still exactly the same opaque, unguessable, server-issued session token the cookie would
// otherwise carry (never a client-asserted userId/username/role of any kind), and it is
// re-validated against the server's own session store via GET /api/auth/me on every app
// bootstrap — a tampered or stale value here authenticates as nobody, it never grants
// access on its own. `sessionStorage` (unlike `localStorage`) is cleared automatically the
// moment the tab/browser closes, which bounds how long a copy of the token can ever live
// on disk. All reads/writes are wrapped in try/catch: some browsers throw when storage is
// unavailable (private-browsing mode, disabled storage) — this must never crash the app,
// it just falls back to the in-memory-only behavior for that session.
// ---------------------------------------------------------------------------
const BEARER_STORAGE_KEY = 'arena_session_token';

function readStoredBearerToken(): string | null {
  try {
    return globalThis.sessionStorage?.getItem(BEARER_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

let bearerToken: string | null = readStoredBearerToken();

export function getBearerToken(): string | null {
  return bearerToken;
}

function setBearerToken(token: string | null): void {
  bearerToken = token;
  try {
    const storage = globalThis.sessionStorage;
    if (!storage) return;
    if (token) storage.setItem(BEARER_STORAGE_KEY, token);
    else storage.removeItem(BEARER_STORAGE_KEY);
  } catch {
    // Storage unavailable (private browsing, disabled) — the in-memory token above still
    // works for the rest of this page's lifetime; it just won't survive a refresh.
  }
}

/** Clears the client-side bearer copy after a confirmed invalid session. The server remains
 *  authoritative: this never changes auth state by itself and is only called after a
 *  server response has proved that the credential is no longer valid (or after logout). */
export function clearBearerToken(): void {
  setBearerToken(null);
}

/** HTTP failures keep their status so callers can distinguish authentication (401) from
 *  authorization (403), throttling (429), server/gateway failures, and network failures.
 *  Only `parseOrThrow`'s explicit 401 branch below invokes the session-expiry hook. */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Session-expiry notification. A 401 from most endpoints (stats, achievements, wallet,
// notifications, match history, rooms, support, ...) means a session that WAS valid has
// stopped being valid — e.g. the server process restarted, or the token/cookie was
// revoked. Without this hook, that 401 used to just become a dead-end "Not authenticated"
// string stuck on whichever screen happened to ask first (e.g. Profile → Stats), while the
// rest of the app still looked logged in. useArena.ts registers a handler here that bounces
// the whole app back to the login screen with the same "session expired" message already
// used for a stale socket connection — but only when a user WAS actually logged in, so this
// never misfires for the normal, expected 401 a fresh signup/login attempt (bad password,
// no session yet) legitimately returns.
// ---------------------------------------------------------------------------
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

async function parseOrThrow<T>(res: Response): Promise<T> {
  const parsed = await res.json().catch(() => ({}));
  const body = (parsed && typeof parsed === 'object' ? parsed : {}) as T & { error?: string };
  if (!res.ok) {
    // A 401 is the only HTTP response that means the credential is invalid. In particular,
    // 403/429/500/502/503 are surfaced to the screen that made the request and never
    // converted into a logout. Network failures never reach this function at all.
    if (res.status === 401) onUnauthorized?.();
    throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status);
  }
  return body;
}

/** Every request includes credentials (the httpOnly session cookie) as the primary
 *  transport, PLUS the in-memory bearer token as a fallback (see comment above) — never a
 *  userId/username in a body, param, or query string to assert who is making the call. */
function apiFetch(path: string, init: RequestInit = {}, includeBearer = true): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  // Read storage at request time as well as from module memory. This keeps a second copy of
  // the module (for example, after a Vite HMR boundary) from losing the token that the
  // signup/login copy already wrote, while still keeping the token scoped to this tab.
  const activeBearerToken = readStoredBearerToken() ?? bearerToken;
  if (includeBearer && activeBearerToken) {
    // Send the same server-issued credential through a second explicit header as well.
    // Some preview/reverse-proxy layers strip or rewrite Authorization even on a same-origin
    // proxied request; the server validates this fallback identically and never treats it
    // as a client identity claim.
    headers.set('Authorization', `Bearer ${activeBearerToken}`);
    headers.set('X-Arena-Session-Token', activeBearerToken);
  }
  return fetch(path, { ...init, headers, credentials: 'include' });
}

export async function signup(name: string, password: string): Promise<ArenaUser> {
  const res = await apiFetch('/api/auth/signup', { method: 'POST', body: JSON.stringify({ name, password }) });
  const body = await parseOrThrow<{ user: ArenaUser; token?: string }>(res);
  setBearerToken(body.token ?? null);
  return body.user;
}

export async function login(name: string, password: string): Promise<ArenaUser> {
  const res = await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ name, password }) });
  const body = await parseOrThrow<{ user: ArenaUser; token?: string }>(res);
  setBearerToken(body.token ?? null);
  return body.user;
}

export async function logout(): Promise<void> {
  try {
    const res = await apiFetch('/api/auth/logout', { method: 'POST' });
    await parseOrThrow<{ ok: boolean }>(res);
  } finally {
    // A local logout must not leave a live bearer credential in sessionStorage when the
    // network is unavailable. The server-side session is still invalidated whenever this
    // request reaches it; the client never pretends a failed request was a server logout.
    setBearerToken(null);
  }
}

/** Returns `null` (rather than throwing) when there is no valid session — this is the
 *  expected, ordinary case on a fresh visit/after a session expires, not an error. */
export async function fetchMe(options: { withoutBearer?: boolean } = {}): Promise<ArenaUser | null> {
  const res = await apiFetch('/api/auth/me', {}, !options.withoutBearer);
  if (res.status === 401) return null;
  const body = await parseOrThrow<{ user: ArenaUser }>(res);
  return body.user;
}

export async function fetchWallet(): Promise<ArenaUser> {
  const res = await apiFetch('/api/wallet');
  const body = await parseOrThrow<{ user: ArenaUser }>(res);
  return body.user;
}

/** Full wallet detail including the recent transaction ledger, for the Wallet modal. */
export async function fetchWalletDetail(): Promise<{ user: ArenaUser; transactions: Transaction[] }> {
  const res = await apiFetch('/api/wallet');
  return parseOrThrow<{ user: ArenaUser; transactions: Transaction[] }>(res);
}

/** Lifetime profile stats (matches played, total wagered, net profit, etc.) for the Profile screen. */
export async function fetchWalletStats(): Promise<WalletStats> {
  const res = await apiFetch('/api/wallet/stats');
  const body = await parseOrThrow<{ stats: WalletStats }>(res);
  return body.stats;
}

/** `requestId` is a fresh client-generated idempotency key (see useArena.ts) so a dropped
 *  response + accidental retry can never double-credit/double-debit the wallet. */
export async function topUpWallet(amount: number, requestId: string): Promise<ArenaUser> {
  const res = await apiFetch('/api/wallet/topup', { method: 'POST', body: JSON.stringify({ amount, requestId }) });
  const body = await parseOrThrow<{ user: ArenaUser }>(res);
  return body.user;
}

export async function withdrawWallet(amount: number, requestId: string): Promise<ArenaUser> {
  const res = await apiFetch('/api/wallet/withdraw', { method: 'POST', body: JSON.stringify({ amount, requestId }) });
  const body = await parseOrThrow<{ user: ArenaUser }>(res);
  return body.user;
}

export async function fetchRooms(): Promise<RoomSummary[]> {
  const res = await apiFetch('/api/rooms');
  const body = await parseOrThrow<{ rooms: RoomSummary[] }>(res);
  return body.rooms;
}

/** Which game modes (duel/squad) are actually enabled right now — real server config
 *  (admin feature flags), never hardcoded client-side. */
export async function fetchGameModes(): Promise<{ modes: GameModeMeta[]; entryFees: number[] }> {
  const res = await apiFetch('/api/game-modes');
  return parseOrThrow(res);
}

// ---------------------------------------------------------------------------
// Match history + stats + achievements — all read-only, all derived server-side from the
// real match ledger/wallet transactions.
// ---------------------------------------------------------------------------
export interface MatchHistoryQuery {
  page?: number;
  pageSize?: number;
  format?: 'all' | 'duel' | 'squad';
  outcome?: 'all' | 'win' | 'loss' | 'draw' | 'void';
}

export async function fetchMatchHistory(query: MatchHistoryQuery = {}): Promise<PaginatedMatchHistory> {
  const params = new URLSearchParams();
  if (query.page) params.set('page', String(query.page));
  if (query.pageSize) params.set('pageSize', String(query.pageSize));
  if (query.format) params.set('format', query.format);
  if (query.outcome) params.set('outcome', query.outcome);
  const res = await apiFetch(`/api/match-history?${params.toString()}`);
  return parseOrThrow(res);
}

export async function fetchMatchDetail(roomId: string): Promise<MatchHistoryItem> {
  const res = await apiFetch(`/api/match-history/${encodeURIComponent(roomId)}`);
  const body = await parseOrThrow<{ match: MatchHistoryItem }>(res);
  return body.match;
}

export async function fetchPlayerStats(): Promise<PlayerStats> {
  const res = await apiFetch('/api/stats');
  const body = await parseOrThrow<{ stats: PlayerStats }>(res);
  return body.stats;
}

export async function fetchAchievements(): Promise<Achievement[]> {
  const res = await apiFetch('/api/achievements');
  const body = await parseOrThrow<{ achievements: Achievement[] }>(res);
  return body.achievements;
}

// ---------------------------------------------------------------------------
// Notifications — real events only.
// ---------------------------------------------------------------------------
export async function fetchNotifications(page = 1, pageSize = 20): Promise<PaginatedNotifications> {
  const res = await apiFetch(`/api/notifications?page=${page}&pageSize=${pageSize}`);
  return parseOrThrow(res);
}

export async function fetchUnreadNotificationCount(): Promise<number> {
  const res = await apiFetch('/api/notifications/unread-count');
  const body = await parseOrThrow<{ unreadCount: number }>(res);
  return body.unreadCount;
}

export async function markNotificationRead(id: string): Promise<NotificationEntry> {
  const res = await apiFetch(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
  const body = await parseOrThrow<{ notification: NotificationEntry }>(res);
  return body.notification;
}

export async function markAllNotificationsRead(): Promise<number> {
  const res = await apiFetch('/api/notifications/read-all', { method: 'POST' });
  const body = await parseOrThrow<{ markedCount: number }>(res);
  return body.markedCount;
}

// ---------------------------------------------------------------------------
// Payment methods + support tickets.
// ---------------------------------------------------------------------------
export async function fetchPaymentMethods(): Promise<PublicPaymentMethods> {
  const res = await apiFetch('/api/payment-methods');
  return parseOrThrow(res);
}

export async function fetchPaymentTransactionMethods(): Promise<{ methods: NonNullable<PublicPaymentMethods['methods']>; note: string }> {
  const res = await apiFetch('/api/payments/methods');
  return parseOrThrow(res);
}

export async function createPaymentDeposit(input: { amount: number; method: 'UPI' | 'CRYPTO'; currency: 'INR' | 'USDT'; idempotencyKey: string; asset?: string; network?: string }): Promise<PlayerPaymentTransaction> {
  const res = await apiFetch('/api/payments/deposits', { method: 'POST', headers: { 'Idempotency-Key': input.idempotencyKey }, body: JSON.stringify(input) });
  const body = await parseOrThrow<{ transaction: PlayerPaymentTransaction }>(res);
  return body.transaction;
}

export async function createPaymentWithdrawal(input: { amount: number; method: 'UPI' | 'CRYPTO'; currency: 'INR' | 'USDT'; idempotencyKey: string; destination: string; asset?: string; network?: string }): Promise<PlayerPaymentTransaction> {
  const res = await apiFetch('/api/payments/withdrawals', { method: 'POST', headers: { 'Idempotency-Key': input.idempotencyKey }, body: JSON.stringify(input) });
  const body = await parseOrThrow<{ transaction: PlayerPaymentTransaction }>(res);
  return body.transaction;
}

export async function fetchPaymentTransactions(operation?: 'DEPOSIT' | 'WITHDRAWAL'): Promise<PlayerPaymentTransaction[]> {
  const query = operation ? `?operation=${operation}` : '';
  const res = await apiFetch(`/api/payments/transactions${query}`);
  const body = await parseOrThrow<{ transactions: PlayerPaymentTransaction[] }>(res);
  return body.transactions;
}

export async function fetchPaymentTransaction(id: string): Promise<PlayerPaymentTransaction> {
  const res = await apiFetch(`/api/payments/transactions/${encodeURIComponent(id)}`);
  const body = await parseOrThrow<{ transaction: PlayerPaymentTransaction }>(res);
  return body.transaction;
}

export async function fetchSupportTickets(): Promise<SupportTicket[]> {
  const res = await apiFetch('/api/support/tickets');
  const body = await parseOrThrow<{ tickets: SupportTicket[] }>(res);
  return body.tickets;
}

export async function fetchSupportTicket(id: string): Promise<SupportTicket> {
  const res = await apiFetch(`/api/support/tickets/${encodeURIComponent(id)}`);
  const body = await parseOrThrow<{ ticket: SupportTicket }>(res);
  return body.ticket;
}

export async function createSupportTicket(subject: string, message: string, category: SupportTicketCategory): Promise<SupportTicket> {
  const res = await apiFetch('/api/support/tickets', { method: 'POST', body: JSON.stringify({ subject, message, category }) });
  const body = await parseOrThrow<{ ticket: SupportTicket }>(res);
  return body.ticket;
}
