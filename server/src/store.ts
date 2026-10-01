/**
 * Minimal file-backed persistence for users and the transaction ledger.
 *
 * Every mutation here (`upsertUser`, `recordTransaction`) is synchronous, and the whole
 * `db` object is (re)written to disk on every call via a write-to-temp-then-rename, which
 * is atomic on POSIX filesystems — a crash mid-write leaves the *old* store.json intact
 * (the half-written temp file is simply orphaned) instead of corrupting the live file.
 * Node being single-threaded means there is no concurrent-write hazard at this scale
 * either. This keeps virtual wallet balances durable across server restarts without
 * pulling in a database dependency for a v1 that intentionally has no real money
 * movement yet — see AUDIT_REPORT.md for why this is still not a real database and what
 * that means for actual production use.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NotificationEntry, Transaction, User } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const DATA_FILE = join(DATA_DIR, 'store.json');
const DATA_FILE_TMP = join(DATA_DIR, 'store.json.tmp');

interface DbShape {
  users: Record<string, User>;
  transactions: Transaction[];
  notifications: NotificationEntry[];
}

function loadDb(): DbShape {
  try {
    if (!existsSync(DATA_FILE)) return { users: {}, transactions: [], notifications: [] };
    const raw = readFileSync(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<DbShape>;
    const users = parsed.users ?? {};
    // Backfill `status` for any record written before that field existed — never let a
    // pre-existing account silently become un-loggable or bypass the admin status check.
    for (const id of Object.keys(users)) {
      const record = users[id] as User;
      if (!record.status) record.status = 'active';
    }
    return {
      users,
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
      notifications: Array.isArray(parsed.notifications) ? parsed.notifications : [],
    };
  } catch {
    // Corrupted file on disk should never crash the server — start fresh in memory.
    return { users: {}, transactions: [], notifications: [] };
  }
}

function saveDb(db: DbShape): void {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    // Atomic write: a crash/kill between these two lines leaves store.json.tmp orphaned
    // and store.json exactly as it was — never a half-written, corrupted store.json.
    writeFileSync(DATA_FILE_TMP, JSON.stringify(db, null, 2), 'utf-8');
    renameSync(DATA_FILE_TMP, DATA_FILE);
  } catch (err) {
    // Persistence failure should degrade to in-memory-only, not crash a live match.
    console.error('Failed to persist store.json:', err);
  }
}

let db = loadDb();

export function getUser(userId: string): User | undefined {
  return db.users[userId];
}

/** Looks a user up by their normalized username key (see auth.ts normalizeUsername) —
 *  the only supported login/signup identity lookup, immune to case-bypass. */
export function findUserByUsernameKey(usernameKey: string): User | undefined {
  return Object.values(db.users).find((u) => u.usernameKey === usernameKey);
}

export function upsertUser(user: User): void {
  db.users[user.id] = user;
  saveDb(db);
}

export function recordTransaction(tx: Transaction): void {
  db.transactions.push(tx);
  // Keep the ledger from growing unbounded in long-running dev sessions.
  if (db.transactions.length > 5000) db.transactions = db.transactions.slice(-5000);
  saveDb(db);
}

export function getTransactionsForUser(userId: string, limit = 25): Transaction[] {
  return db.transactions
    .filter((t) => t.userId === userId)
    .slice(-limit)
    .reverse();
}

/** Every transaction ever recorded for this user, unbounded — used for lifetime profile
 *  stats (matches played, total wagered, etc.) where `getTransactionsForUser`'s 25-entry
 *  cap for the ledger UI would quietly under-count an active player's history. */
export function getAllTransactionsForUser(userId: string): Transaction[] {
  return db.transactions.filter((t) => t.userId === userId);
}

// ---------------------------------------------------------------------------
// Admin-only read access. These never leave the server process directly — every admin
// route funnels its response through its own public-projection function (see
// server/src/admin/users.ts / transactions.ts) exactly the same way the player-facing
// routes funnel through toPublicUser(). Nothing here is a new trust boundary: it is the
// same store, just with the query shapes an operator screen actually needs (list-all,
// search, paginate) instead of the single-user lookups the player API needs.
// ---------------------------------------------------------------------------

/** Every user record, unfiltered — callers are responsible for pagination/redaction. Used
 *  only by the admin subsystem (server/src/admin/*), which is itself gated by admin
 *  auth + RBAC before this is ever reached. */
export function listAllUsersRaw(): User[] {
  return Object.values(db.users);
}

export function countUsers(): number {
  return Object.keys(db.users).length;
}

/** Every transaction ever recorded, across every user — used only by admin transaction
 *  search/reporting and analytics, which apply their own pagination/filtering on top. */
export function listAllTransactionsRaw(): Transaction[] {
  return db.transactions;
}

// ---------------------------------------------------------------------------
// Player notification center storage. Append-only from the app's perspective (entries are
// never deleted, only marked read) — see notifications.ts for the real event triggers.
// ---------------------------------------------------------------------------

const MAX_NOTIFICATIONS_PER_USER = 200;

export function appendNotification(entry: NotificationEntry): void {
  db.notifications.push(entry);
  // Cap per-user, not globally — an active player's own feed should never be pushed out by
  // other users' activity, but it also shouldn't grow unbounded for a long-lived account.
  const forUser = db.notifications.filter((n) => n.userId === entry.userId);
  if (forUser.length > MAX_NOTIFICATIONS_PER_USER) {
    const toDrop = forUser.length - MAX_NOTIFICATIONS_PER_USER;
    const dropIds = new Set(forUser.slice(0, toDrop).map((n) => n.id));
    db.notifications = db.notifications.filter((n) => !dropIds.has(n.id));
  }
  saveDb(db);
}

export function listNotificationsForUser(userId: string): NotificationEntry[] {
  return db.notifications.filter((n) => n.userId === userId);
}

export function markNotificationRead(userId: string, id: string): NotificationEntry | null {
  const entry = db.notifications.find((n) => n.id === id && n.userId === userId);
  if (!entry) return null;
  entry.read = true;
  saveDb(db);
  return entry;
}

export function markAllNotificationsRead(userId: string): number {
  let count = 0;
  for (const n of db.notifications) {
    if (n.userId === userId && !n.read) {
      n.read = true;
      count += 1;
    }
  }
  if (count > 0) saveDb(db);
  return count;
}

/** Test-only escape hatch so the self-test suite starts from a clean slate. */
export function __resetStoreForTests(): void {
  db = { users: {}, transactions: [], notifications: [] };
  saveDb(db);
}
