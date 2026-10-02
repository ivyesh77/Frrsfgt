import { createHash } from 'node:crypto';
import { getRedisClient } from './redis.js';
import { query, withDatabaseTransaction } from './database.js';

export type SessionPrincipalType = 'PLAYER' | 'ADMIN' | 'OPERATOR';
export interface SessionPrincipal { type: SessionPrincipalType; id: string; }
export interface DurableSession { tokenHash: string; principal: SessionPrincipal; expiresAt: number; }

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function ttlSeconds(expiresAt: number): number {
  return Math.max(1, Math.ceil((expiresAt - Date.now()) / 1_000));
}

/** Redis-backed session repository for horizontally scaled deployments. Raw bearer values
 * are never stored; only a SHA-256 token digest is used as the key. */
export async function createRedisSession(token: string, principal: SessionPrincipal, expiresAt: number): Promise<void> {
  const redis = getRedisClient();
  const tokenHash = hashSessionToken(token);
  const key = `session:${tokenHash}`;
  const principalKey = `session-principal:${principal.type}:${principal.id}`;
  const payload = JSON.stringify({ tokenHash, principal, expiresAt });
  const result = await redis.multi().set(key, payload, 'EX', ttlSeconds(expiresAt), 'NX').sadd(principalKey, tokenHash).expire(principalKey, ttlSeconds(expiresAt)).exec();
  if (!result || result[0]?.[1] !== 'OK') throw new Error('Session already exists');
}

export async function resolveRedisSession(token: string): Promise<DurableSession | null> {
  const redis = getRedisClient();
  const payload = await redis.get(`session:${hashSessionToken(token)}`);
  if (!payload) return null;
  const session = JSON.parse(payload) as DurableSession;
  if (session.expiresAt <= Date.now()) {
    await revokeRedisSession(token);
    return null;
  }
  const nextExpiry = Date.now() + Math.max(60_000, Number(process.env.SESSION_IDLE_TTL_MS ?? 7 * 24 * 60 * 60 * 1_000));
  session.expiresAt = nextExpiry;
  await redis.set(`session:${session.tokenHash}`, JSON.stringify(session), 'EX', ttlSeconds(nextExpiry));
  return session;
}

export async function revokeRedisSession(token: string): Promise<void> {
  const redis = getRedisClient();
  const tokenHash = hashSessionToken(token);
  const payload = await redis.get(`session:${tokenHash}`);
  const session = payload ? JSON.parse(payload) as DurableSession : null;
  const multi = redis.multi().del(`session:${tokenHash}`);
  if (session) multi.srem(`session-principal:${session.principal.type}:${session.principal.id}`, tokenHash);
  await multi.exec();
}

export async function revokeAllRedisSessions(principal: SessionPrincipal): Promise<number> {
  const redis = getRedisClient();
  const principalKey = `session-principal:${principal.type}:${principal.id}`;
  const tokenHashes = await redis.smembers(principalKey);
  if (!tokenHashes.length) return 0;
  const multi = redis.multi().del(...tokenHashes.map((hash) => `session:${hash}`)).del(principalKey);
  await multi.exec();
  return tokenHashes.length;
}

/** PostgreSQL implementation for teams that do not operate Redis. The SELECT FOR UPDATE
 * and revocation timestamp make invalidation and sliding expiry safe across API instances. */
export async function createPostgresSession(token: string, principal: SessionPrincipal, expiresAt: number): Promise<void> {
  await query('INSERT INTO sessions (token_hash, principal_type, principal_id, expires_at) VALUES ($1, $2, $3, to_timestamp($4 / 1000.0))', [hashSessionToken(token), principal.type, principal.id, expiresAt]);
}

export async function resolvePostgresSession(token: string): Promise<DurableSession | null> {
  return withDatabaseTransaction(async (client) => {
    const result = await client.query<{ token_hash: string; principal_type: SessionPrincipalType; principal_id: string; expires_at: Date }>('SELECT token_hash, principal_type, principal_id, expires_at FROM sessions WHERE token_hash = $1 AND revoked_at IS NULL FOR UPDATE', [hashSessionToken(token)]);
    const row = result.rows[0];
    if (!row || row.expires_at.getTime() <= Date.now()) {
      if (row) await client.query('UPDATE sessions SET revoked_at = now() WHERE token_hash = $1', [row.token_hash]);
      return null;
    }
    const nextExpiry = Date.now() + Math.max(60_000, Number(process.env.SESSION_IDLE_TTL_MS ?? 7 * 24 * 60 * 60 * 1_000));
    await client.query('UPDATE sessions SET last_seen_at = now(), expires_at = to_timestamp($2 / 1000.0) WHERE token_hash = $1', [row.token_hash, nextExpiry]);
    return { tokenHash: row.token_hash, principal: { type: row.principal_type, id: row.principal_id }, expiresAt: nextExpiry };
  });
}

export async function revokePostgresSession(token: string): Promise<void> {
  await query('UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [hashSessionToken(token)]);
}

export async function revokeAllPostgresSessions(principal: SessionPrincipal): Promise<number> {
  const result = await query('UPDATE sessions SET revoked_at = now() WHERE principal_type = $1 AND principal_id = $2 AND revoked_at IS NULL', [principal.type, principal.id]);
  return result.rowCount ?? 0;
}
