import type { ArenaUser, RoomSummary, Transaction, WalletStats } from './types';

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
