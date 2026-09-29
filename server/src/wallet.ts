import { nanoid } from 'nanoid';
import { getAllTransactionsForUser, getTransactionsForUser, getUser, recordTransaction, upsertUser } from './store.js';
import { STARTING_WALLET_BALANCE, type Transaction, type TransactionType, type User, type WalletStats } from './types.js';

export class InsufficientFundsError extends Error {
  constructor() {
    super('Insufficient wallet balance');
  }
}

export function createGuestUser(name: string): User {
  const user: User = {
    id: nanoid(12),
    name: name.trim().slice(0, 24) || 'Player',
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
  });
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
  };
  recordTransaction(tx);
  return updated;
}

/** Demo top-up only — this is where a real payment gateway callback would credit funds later. */
export function topUp(userId: string, amount: number): User {
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000) {
    throw new Error('Invalid top-up amount');
  }
  return applyDelta(userId, 'topup', Math.round(amount));
}

/** Demo cash-out only — this is where a real payout/crypto-transfer would debit funds later.
 *  Withdrawing more than the current balance is rejected (never allows an overdraft). */
export function withdraw(userId: string, amount: number): User {
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000) {
    throw new Error('Invalid withdrawal amount');
  }
  const user = getUser(userId);
  if (!user) throw new Error('Unknown user');
  const roundedAmount = Math.round(amount);
  if (roundedAmount > user.walletBalance) throw new InsufficientFundsError();
  return applyDelta(userId, 'withdrawal', -roundedAmount);
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
