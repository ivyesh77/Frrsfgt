import type {
  Achievement,
  ArenaUser,
  GameModeMeta,
  MatchHistoryItem,
  NotificationEntry,
  PaginatedMatchHistory,
  PaginatedNotifications,
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
// This token is kept ONLY in this module-level JS variable — never localStorage, never
// sessionStorage, never anywhere disk-persisted or readable outside this tab's running JS.
// That is a deliberate trade-off: a hard page refresh loses it (falling back to whatever
// the cookie alone can still do), which is an acceptable cost for a token that otherwise
// behaves exactly like the cookie — an opaque, server-issued, unguessable session id, never
// a client-asserted userId of any kind.
// ---------------------------------------------------------------------------
let bearerToken: string | null = null;

export function getBearerToken(): string | null {
  return bearerToken;
}

function setBearerToken(token: string | null): void {
  bearerToken = token;
}

async function parseOrThrow<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

/** Every request includes credentials (the httpOnly session cookie) as the primary
 *  transport, PLUS the in-memory bearer token as a fallback (see comment above) — never a
 *  userId/username in a body, param, or query string to assert who is making the call. */
function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (bearerToken) headers.set('Authorization', `Bearer ${bearerToken}`);
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
  await apiFetch('/api/auth/logout', { method: 'POST' });
  setBearerToken(null);
}

/** Returns `null` (rather than throwing) when there is no valid session — this is the
 *  expected, ordinary case on a fresh visit/after a session expires, not an error. */
export async function fetchMe(): Promise<ArenaUser | null> {
  const res = await apiFetch('/api/auth/me');
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
