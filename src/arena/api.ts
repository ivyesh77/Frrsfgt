import type { ArenaUser, Transaction } from './types';

async function parseOrThrow<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

export type AuthMode = 'login' | 'signup';

export async function guestLogin(name: string, mode?: AuthMode): Promise<ArenaUser> {
  const res = await fetch('/api/auth/guest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mode }),
  });
  const body = await parseOrThrow<{ user: ArenaUser }>(res);
  return body.user;
}

export async function fetchWallet(userId: string): Promise<ArenaUser> {
  const res = await fetch(`/api/wallet/${userId}`);
  const body = await parseOrThrow<{ user: ArenaUser }>(res);
  return body.user;
}

/** Full wallet detail including the recent transaction ledger, for the Wallet modal. */
export async function fetchWalletDetail(userId: string): Promise<{ user: ArenaUser; transactions: Transaction[] }> {
  const res = await fetch(`/api/wallet/${userId}`);
  return parseOrThrow<{ user: ArenaUser; transactions: Transaction[] }>(res);
}

export async function topUpWallet(userId: string, amount: number): Promise<ArenaUser> {
  const res = await fetch(`/api/wallet/${userId}/topup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount }),
  });
  const body = await parseOrThrow<{ user: ArenaUser }>(res);
  return body.user;
}

export async function withdrawWallet(userId: string, amount: number): Promise<ArenaUser> {
  const res = await fetch(`/api/wallet/${userId}/withdraw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount }),
  });
  const body = await parseOrThrow<{ user: ArenaUser }>(res);
  return body.user;
}
