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
import {
  countStoredSessionsForUser,
  createStoredSession,
  destroyAllStoredSessionsForUser,
  destroyStoredSession,
  resetStoredSessionsForTests,
  resolveStoredSession,
} from './sessionStore.js';

const scryptAsync = promisify(scrypt);

const SCRYPT_KEY_LENGTH = 64;
const SESSION_TOKEN_BYTES = 32;
/** Sessions are idle-expired: any authenticated request pushes the expiry forward, so an
 * active player is never logged out mid-session, but a token that stops being used goes
 * stale and is rejected. */
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
 * cannot be used to guess a correct password byte-by-byte. */
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
// Sessions. Tokens remain opaque random credentials, but their server-side records live in
// a durable journal rather than a process-local Map. A normal refresh, a server restart,
// and multiple processes pointed at the same SESSION_STORE_FILE use the same lookup. The
// seven-day idle expiry remains enforced; sessions are not permanent.
// ---------------------------------------------------------------------------

export function createSession(userId: string): { token: string; expiresAt: number } {
  const token = randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  createStoredSession(token, userId, expiresAt);
  return { token, expiresAt };
}

/** Returns the authenticated userId for a valid, non-expired token — and slides the
 * expiry forward (idle-timeout semantics) — or `null` if the token is missing/expired. */
export function resolveSession(token: string | undefined | null): string | null {
  return resolveStoredSession(token, Date.now(), Date.now() + SESSION_TTL_MS);
}

export function destroySession(token: string | undefined | null): void {
  destroyStoredSession(token);
}

/** Invalidates EVERY active session for a given account, regardless of which device/tab it
 * was created from — used by the admin "force logout" action and automatically whenever an
 * admin suspends/bans a user. Returns how many sessions were actually destroyed. */
export function destroyAllSessionsForUser(userId: string): number {
  return destroyAllStoredSessionsForUser(userId);
}

/** Read-only visibility for the admin "session/device summary" panel — deliberately
 * returns only the count and the nearest expiry, never the token itself (a session token
 * is a live credential; even an admin should never be able to read or reconstruct one). */
export function countActiveSessionsForUser(userId: string): { count: number; nearestExpiresAt: number | null } {
  return countStoredSessionsForUser(userId);
}

/** Test-only escape hatch so the self-test suite starts from a clean slate. */
export function __resetSessionsForTests(): void {
  resetStoredSessionsForTests();
}
