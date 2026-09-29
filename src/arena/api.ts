import type { ArenaUser } from './types';

async function parseOrThrow<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

export async function guestLogin(name: string): Promise<ArenaUser> {
  const res = await fetch('/api/auth/guest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const body = await parseOrThrow<{ user: ArenaUser }>(res);
  return body.user;
}

export async function fetchWallet(userId: string): Promise<ArenaUser> {
  const res = await fetch(`/api/wallet/${userId}`);
  const body = await parseOrThrow<{ user: ArenaUser }>(res);
  return body.user;
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
