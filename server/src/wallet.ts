import { nanoid } from 'nanoid';
import { hashPassword, normalizeUsername, verifyPassword } from './auth.js';
import { findUserByUsernameKey, getAllTransactionsForUser, getTransactionsForUser, getUser, recordTransaction, upsertUser } from './store.js';
import {
  STARTING_WALLET_BALANCE,
  type PublicUser,
  type Transaction,
  type TransactionType,
  type User,
  type WalletStats,
} from './types.js';

export class InsufficientFundsError extends Error {
  constructor() {
    super('Insufficient wallet balance');
  }
}

export class InvalidCredentialsError extends Error {
  constructor(message = 'Invalid username or password') {
    super(message);
  }
}

export class UsernameTakenError extends Error {
  constructor() {
    super('That name is already taken. Try logging in instead.');
  }
}

/** The only shape ever allowed to leave the server — strips `passwordHash` and
 *  `usernameKey`. Every route must funnel its response through this. */
export function toPublicUser(user: User): PublicUser {
  return { id: user.id, name: user.name, walletBalance: user.walletBalance, createdAt: user.createdAt };
}

const MIN_PASSWORD_LENGTH = 8;

/** Creates a brand-new account with a hashed password. Throws `UsernameTakenError` if the
 *  normalized name is already registered (case-insensitively — "User"/"USER"/"user" can
 *  never become three separate accounts). */
export async function registerUser(name: string, password: string): Promise<User> {
  const usernameKey = normalizeUsername(name);
  if (findUserByUsernameKey(usernameKey)) throw new UsernameTakenError();
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  const passwordHash = await hashPassword(password);
  const user: User = {
    id: nanoid(12),
    usernameKey,
    name: name.trim().slice(0, 24) || 'Player',
    passwordHash,
    walletBalance: STARTING_WALLET_BALANCE,
    createdAt: Date.now(),
  };
  upsertUser(user);
  recordTransaction({
    id: nanoid(12),
    userId: user.id,
    // Distinct from a player-initiated 'topup' so profile stats (and the wallet ledger UI)
    // don't count the automatic starting grant as a deposit the player actually made.
    type: 'signup_bonus',
    amount: STARTING_WALLET_BALANCE,
    balanceAfter: user.walletBalance,
    timestamp: Date.now(),
    status: 'completed',
  });
  return user;
}

/** Verifies a password against the stored hash. Throws `InvalidCredentialsError` for
 *  both "no such account" and "wrong password" — the response is intentionally identical
 *  either way so a login attempt can never be used to enumerate which usernames exist. */
export async function authenticateUser(name: string, password: string): Promise<User> {
  const usernameKey = normalizeUsername(name);
  const user = findUserByUsernameKey(usernameKey);
  if (!user) {
    // Still run a hash comparison against a dummy value so a nonexistent-username request
    // takes roughly the same time as a wrong-password one (timing-based user enumeration).
    await hashPassword(password);
    throw new InvalidCredentialsError();
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) throw new InvalidCredentialsError();
  return user;
}

function applyDelta(userId: string, type: TransactionType, amount: number, roomId?: string): User {
  const user = getUser(userId);
  if (!user) throw new Error('Unknown user');
  const nextBalance = user.walletBalance + amount;
  if (nextBalance < 0) throw new InsufficientFundsError();
  const updated: User = { ...user, walletBalance: nextBalance };
  upsertUser(updated);
  const tx: Transaction = {
    id: nanoid(12),
    userId,
    type,
    amount,
    roomId,
    balanceAfter: updated.walletBalance,
    timestamp: Date.now(),
    status: 'completed',
  };
  recordTransaction(tx);
  return updated;
}

// ---------------------------------------------------------------------------
// Idempotency for client-initiated financial actions (deposit/withdraw). A client
// supplies its own freshly-generated `requestId` per button press; if the same
// (userId, operation, requestId) is seen again within the TTL — e.g. a retried
// request after a dropped response, or an accidental double-submit — the original
// result is returned instead of executing the mutation a second time. This is on
// top of (not instead of) the fact that every mutation here is fully synchronous
// with no `await` in the critical section, which already rules out a true
// concurrent-request race (verified live: 10 parallel withdrawals against a 1000
// balance produced exactly 5 successes and a final balance of exactly 0, never
// negative).
// ---------------------------------------------------------------------------
const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;
interface IdempotencyRecord {
  result: User;
  timestamp: number;
}
const idempotencyCache = new Map<string, IdempotencyRecord>();

function pruneIdempotencyCache(): void {
  const cutoff = Date.now() - IDEMPOTENCY_TTL_MS;
  for (const [key, record] of idempotencyCache) {
    if (record.timestamp < cutoff) idempotencyCache.delete(key);
  }
}

function withIdempotency(userId: string, operation: string, requestId: string | undefined, run: () => User): User {
  if (!requestId) return run();
  pruneIdempotencyCache();
  const key = `${userId}:${operation}:${requestId}`;
  const existing = idempotencyCache.get(key);
  if (existing) return existing.result;
  const result = run();
  idempotencyCache.set(key, { result, timestamp: Date.now() });
  return result;
}

/** Test-only escape hatch so the self-test suite starts from a clean slate. */
export function __resetWalletIdempotencyForTests(): void {
  idempotencyCache.clear();
}

/** Demo top-up only — this is where a real payment gateway callback would credit funds
 *  later (see AUDIT_REPORT.md / SECURITY_REPORT.md: this is explicitly a practice-currency
 *  ledger write, not a payment integration). `requestId` is an optional client-generated
 *  idempotency key — see withIdempotency above. */
export function topUp(userId: string, amount: number, requestId?: string): User {
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000) {
    throw new Error('Invalid top-up amount');
  }
  return withIdempotency(userId, 'topup', requestId, () => applyDelta(userId, 'topup', Math.round(amount)));
}

/** Demo cash-out only — this is where a real payout/crypto-transfer would debit funds
 *  later. Withdrawing more than the current balance is rejected (never allows an
 *  overdraft). `requestId` is an optional client-generated idempotency key. */
export function withdraw(userId: string, amount: number, requestId?: string): User {
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000) {
    throw new Error('Invalid withdrawal amount');
  }
  return withIdempotency(userId, 'withdraw', requestId, () => {
    const user = getUser(userId);
    if (!user) throw new Error('Unknown user');
    const roundedAmount = Math.round(amount);
    if (roundedAmount > user.walletBalance) throw new InsufficientFundsError();
    return applyDelta(userId, 'withdrawal', -roundedAmount);
  });
}

export function debitEntryFee(userId: string, amount: number, roomId: string): User {
  return applyDelta(userId, 'entry_fee', -amount, roomId);
}

export function refundEntryFee(userId: string, amount: number, roomId: string): User {
  return applyDelta(userId, 'refund', amount, roomId);
}

export function creditPayout(userId: string, amount: number, roomId: string): User {
  return applyDelta(userId, 'payout', amount, roomId);
}

export function recentTransactions(userId: string): Transaction[] {
  return getTransactionsForUser(userId);
}

/** Lifetime profile stats computed from the user's entire ledger (see
 *  getAllTransactionsForUser — never capped like the wallet-history UI feed). */
export function getWalletStats(userId: string): WalletStats {
  const user = getUser(userId);
  if (!user) throw new Error('Unknown user');

  const roomsWagered = new Set<string>();
  let wins = 0;
  let totalWagered = 0;
  let totalWon = 0;
  let totalRefunded = 0;
  let totalDeposited = 0;
  let totalWithdrawn = 0;

  for (const tx of getAllTransactionsForUser(userId)) {
    switch (tx.type) {
      case 'entry_fee':
        if (tx.roomId) roomsWagered.add(tx.roomId);
        totalWagered += Math.abs(tx.amount);
        break;
      case 'payout':
        wins += 1;
        totalWon += tx.amount;
        break;
      case 'refund':
        totalRefunded += tx.amount;
        break;
      case 'topup':
        totalDeposited += tx.amount;
        break;
      case 'withdrawal':
        totalWithdrawn += Math.abs(tx.amount);
        break;
      default:
        break;
    }
  }

  return {
    memberSince: user.createdAt,
    matchesPlayed: roomsWagered.size,
    wins,
    totalWagered,
    totalWon,
    totalRefunded,
    totalDeposited,
    totalWithdrawn,
    netGameProfit: totalWon + totalRefunded - totalWagered,
  };
}
