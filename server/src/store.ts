/**
 * Minimal file-backed persistence for users and the transaction ledger.
 * Node is single-threaded and every write here is synchronous, so there is
 * no concurrent-write hazard at this scale. This keeps virtual wallet
 * balances durable across server restarts without pulling in a database
 * dependency for a v1 that intentionally has no real money movement yet.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Transaction, User } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const DATA_FILE = join(DATA_DIR, 'store.json');

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
    writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf-8');
  } catch (err) {
    // Persistence failure should degrade to in-memory-only, not crash a live match.
    console.error('Failed to persist store.json:', err);
  }
}

let db = loadDb();

export function getUser(userId: string): User | undefined {
  return db.users[userId];
}

export function findUserByName(name: string): User | undefined {
  return Object.values(db.users).find((u) => u.name.toLowerCase() === name.toLowerCase());
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

/** Test-only escape hatch so the self-test suite starts from a clean slate. */
export function __resetStoreForTests(): void {
  db = { users: {}, transactions: [] };
  saveDb(db);
}
