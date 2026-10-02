/**
 * Small server-owned session journal.
 *
 * Sessions are credentials, so they never belong in a client-readable store. This journal
 * keeps the same opaque random token/session record across a process restart and lets
 * multiple server processes use the same configured file on a shared filesystem. Mutations
 * are append-only: unlike a read/modify/write JSON map, two processes cannot silently lose
 * each other's login or logout event. The file is created with owner-only permissions.
 *
 * For a true horizontally scaled deployment, SESSION_STORE_FILE must point at a shared,
 * append-safe store (or this module should be replaced with Redis/DB-backed storage). The
 * default is the app's local data directory, which is persistent for a single server host.
 */
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface StoredSession {
  userId: string;
  expiresAt: number;
}

export class SessionStoreUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionStoreUnavailableError';
  }
}

type SessionEvent =
  | { op: 'create'; token: string; userId: string; expiresAt: number }
  | { op: 'touch'; token: string; expiresAt: number }
  | { op: 'destroy'; token: string }
  | { op: 'destroyUser'; userId: string };

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultPath = join(__dirname, '..', 'data', 'sessions.log');
const sessionFile = process.env.SESSION_STORE_FILE
  ? isAbsolute(process.env.SESSION_STORE_FILE)
    ? process.env.SESSION_STORE_FILE
    : join(process.cwd(), process.env.SESSION_STORE_FILE)
  : defaultPath;

function readSessions(): Map<string, StoredSession> {
  const sessions = new Map<string, StoredSession>();
  if (!existsSync(sessionFile)) return sessions;
  try {
    const content = readFileSync(sessionFile, 'utf8');
    for (const line of content.split('\n')) {
      if (!line) continue;
      let event: SessionEvent;
      try {
        event = JSON.parse(line) as SessionEvent;
      } catch {
        // A truncated final line must not discard the valid events before it.
        continue;
      }
      if (event.op === 'create') sessions.set(event.token, { userId: event.userId, expiresAt: event.expiresAt });
      else if (event.op === 'touch') {
        const existing = sessions.get(event.token);
        if (existing) existing.expiresAt = event.expiresAt;
      } else if (event.op === 'destroy') sessions.delete(event.token);
      else if (event.op === 'destroyUser') {
        for (const [token, session] of sessions) {
          if (session.userId === event.userId) sessions.delete(token);
        }
      }
    }
  } catch {
    // An unavailable/corrupt session journal fails closed: no token is accepted.
  }
  return sessions;
}

function append(event: SessionEvent): void {
  try {
    mkdirSync(dirname(sessionFile), { recursive: true, mode: 0o700 });
    appendFileSync(sessionFile, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
    // chmod also protects a file that existed before this process started.
    chmodSync(sessionFile, 0o600);
  } catch (err) {
    // A login/logout must not claim durable session state when the journal cannot be written.
    // The caller gets a failed-closed result for reads; writes are logged and re-thrown.
    throw new SessionStoreUnavailableError(`Session store is unavailable: ${err instanceof Error ? err.message : 'write failed'}`);
  }
}

export function createStoredSession(token: string, userId: string, expiresAt: number): void {
  append({ op: 'create', token, userId, expiresAt });
}

export function resolveStoredSession(token: string | undefined | null, now: number, nextExpiresAt: number): string | null {
  if (!token) return null;
  const session = readSessions().get(token);
  if (!session) return null;
  if (session.expiresAt < now) {
    append({ op: 'destroy', token });
    return null;
  }
  session.expiresAt = nextExpiresAt;
  append({ op: 'touch', token, expiresAt: nextExpiresAt });
  return session.userId;
}

export function destroyStoredSession(token: string | undefined | null): void {
  if (token) append({ op: 'destroy', token });
}

export function destroyAllStoredSessionsForUser(userId: string): number {
  const sessions = readSessions();
  let count = 0;
  for (const session of sessions.values()) {
    if (session.userId === userId) count += 1;
  }
  if (count > 0) append({ op: 'destroyUser', userId });
  return count;
}

export function countStoredSessionsForUser(userId: string): { count: number; nearestExpiresAt: number | null } {
  let count = 0;
  let nearestExpiresAt: number | null = null;
  for (const session of readSessions().values()) {
    if (session.userId !== userId) continue;
    count += 1;
    if (nearestExpiresAt === null || session.expiresAt < nearestExpiresAt) nearestExpiresAt = session.expiresAt;
  }
  return { count, nearestExpiresAt };
}

/** Test-only cleanup. Runtime logout uses destroyStoredSession so the invalidation is durable. */
export function resetStoredSessionsForTests(): void {
  try {
    if (existsSync(sessionFile)) unlinkSync(sessionFile);
  } catch {
    // A subsequent read fails closed; keep test cleanup best-effort.
  }
}
