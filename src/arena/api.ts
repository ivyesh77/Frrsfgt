import type { ArenaUser, RoomSummary, Transaction, WalletStats } from './types';

async function parseOrThrow<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

/** Every request includes credentials (the httpOnly session cookie) — this is the ONLY
 *  thing that identifies the caller to the server. Nothing in this file ever sends a
 *  userId/username in a body, param, or query string to assert who is making the call. */
function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(path, { ...init, headers, credentials: 'include' });
}

export async function signup(name: string, password: string): Promise<ArenaUser> {
  const res = await apiFetch('/api/auth/signup', { method: 'POST', body: JSON.stringify({ name, password }) });
  const body = await parseOrThrow<{ user: ArenaUser }>(res);
  return body.user;
}

export async function login(name: string, password: string): Promise<ArenaUser> {
  const res = await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ name, password }) });
  const body = await parseOrThrow<{ user: ArenaUser }>(res);
  return body.user;
}

export async function logout(): Promise<void> {
  await apiFetch('/api/auth/logout', { method: 'POST' });
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
