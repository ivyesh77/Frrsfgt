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
import type { Transaction, User } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const DATA_FILE = join(DATA_DIR, 'store.json');
const DATA_FILE_TMP = join(DATA_DIR, 'store.json.tmp');

interface DbShape {
  users: Record<string, User>;
  transactions: Transaction[];
}

function loadDb(): DbShape {
  try {
    if (!existsSync(DATA_FILE)) return { users: {}, transactions: [] };
    const raw = readFileSync(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<DbShape>;
    return {
      users: parsed.users ?? {},
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
    };
  } catch {
    // Corrupted file on disk should never crash the server — start fresh in memory.
    return { users: {}, transactions: [] };
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

/** Test-only escape hatch so the self-test suite starts from a clean slate. */
export function __resetStoreForTests(): void {
  db = { users: {}, transactions: [] };
  saveDb(db);
}
