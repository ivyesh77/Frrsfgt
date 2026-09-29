/**
 * Real authentication: password hashing (scrypt, a modern memory-hard KDF built into
 * Node — no extra native dependency required) and server-side session tokens.
 *
 * Nothing in this file ever trusts a client-supplied identity. A session token is an
 * opaque, unguessable, server-generated random string; the only thing a client can do
 * with it is prove "I am whoever this token was issued to" by sending it back. There is
 * no client-supplied userId anywhere in this module.
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

const SCRYPT_KEY_LENGTH = 64;
const SESSION_TOKEN_BYTES = 32;
/** Sessions are idle-expired: any authenticated request pushes the expiry forward, so an
 *  active player is never logged out mid-session, but a token that stops being used goes
 *  stale and is rejected. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

/** Hashes `password` with a fresh random salt. Stored format: "salt:hash" (both hex). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scryptAsync(password, salt, SCRYPT_KEY_LENGTH)) as Buffer;
  return `${salt}:${derived.toString('hex')}`;
}

/** Constant-time comparison — never short-circuits on the first differing byte, so timing
 *  cannot be used to guess a correct password byte-by-byte. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hashHex] = stored.split(':');
  if (!salt || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = (await scryptAsync(password, salt, expected.length)) as Buffer;
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

// ---------------------------------------------------------------------------
// Username normalization — prevents "User" / "USER" / "user" becoming distinct accounts
// (case-bypass / duplicate-identity), independent of the display name shown in the UI.
// ---------------------------------------------------------------------------
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Sessions. Kept in-memory (this server is already a single, in-memory-plus-JSON-file
// process — see store.ts — so this introduces no new architectural assumption). A
// restart invalidates all sessions, which is an acceptable, honest tradeoff for this
// stage; a production deployment with multiple server instances would move this to a
// shared store (Redis, DB-backed sessions) instead, unchanged from the outside.
// ---------------------------------------------------------------------------

interface Session {
  userId: string;
  expiresAt: number;
}

const sessions = new Map<string, Session>();

export function createSession(userId: string): { token: string; expiresAt: number } {
  const token = randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(token, { userId, expiresAt });
  return { token, expiresAt };
}

/** Returns the authenticated userId for a valid, non-expired token — and slides the
 *  expiry forward (idle-timeout semantics) — or `null` if the token is missing/expired. */
export function resolveSession(token: string | undefined | null): string | null {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return session.userId;
}

export function destroySession(token: string | undefined | null): void {
  if (!token) return;
  sessions.delete(token);
}

/** Test-only escape hatch so the self-test suite starts from a clean slate. */
export function __resetSessionsForTests(): void {
  sessions.clear();
}
