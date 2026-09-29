/**
 * Client-side mirror of the backend's wire types (server/src/types.ts).
 * The frontend and backend are separate TypeScript projects/runtimes (Vite
 * browser bundle vs. Node server), so there is no shared package to import
 * from — these shapes are kept in sync by hand. Keep field names identical
 * to the server so payloads can be used as-is without any mapping layer.
 */

/** This product ships a single game (Memory Match). GameKind is kept as a
 *  named type — mirroring the backend — rather than inlining the literal
 *  everywhere, so a second game could be added later without reshaping
 *  every call site. */
export type GameKind = 'memoryMatch';

export const GAME_KINDS: GameKind[] = ['memoryMatch'];

export const GAME_KIND_LABELS: Record<GameKind, string> = {
  memoryMatch: 'Memory Match',
};

export const GAME_KIND_TAGLINES: Record<GameKind, string> = {
  memoryMatch: 'Memorize the icon, then spot its twin among four before time runs out.',
};

export const ENTRY_FEE_TIERS = [10, 50, 100, 500, 1000, 5000, 10000] as const;

/** Mirrors server/src/types.ts — every room is one of two fixed formats that only
 *  start once completely full: a 1v1 duel (winner takes the entire winner pool,
 *  loser gets nothing) or a 4-player squad match (top 2 scorers split the pool
 *  60/40, best to worst; bottom 2 win nothing). */
export type RoomFormat = 'duel' | 'squad';

export interface RoomFormatMeta {
  id: RoomFormat;
  label: string;
  tagline: string;
  icon: string;
  players: number;
  winnerCount: number;
}

export const ROOM_FORMATS: RoomFormatMeta[] = [
  { id: 'duel', label: '1v1 Duel', tagline: 'Winner takes the entire pool. Loser walks away with nothing.', icon: '⚔️', players: 2, winnerCount: 1 },
  { id: 'squad', label: '4-Player Squad', tagline: 'Top 2 scorers split the pool. Bottom 2 win nothing.', icon: '👥', players: 4, winnerCount: 2 },
];

export function roomFormatMeta(format: RoomFormat): RoomFormatMeta {
  const found = ROOM_FORMATS.find((f) => f.id === format);
  if (found) return found;
  const fallback = ROOM_FORMATS.find((f) => f.id === 'squad');
  if (!fallback) throw new Error('ROOM_FORMATS is missing the squad format'); // invariant: never actually empty
  return fallback;
}

/** Mirrors server/src/types.ts — used purely for client-side display math
 *  (e.g. showing a room's potential win amount before joining). The server
 *  is always the source of truth for the real payout at match end. */
export const PLATFORM_FEE_RATE = 0.2; // 20% platform cut, 80% to the winners
/** @deprecated kept only for the squad format; prefer roomFormatMeta(format).players */
export const MAX_PLAYERS_PER_ROOM = 4;
export const FIRST_PLACE_SHARE = 0.6; // squad format only: 1st place's cut of the winner pool; 2nd gets the remainder

/** Combined winner pool for a pool of this size (80% of it), rounded the same way the server rounds it. */
export function winnerShareOf(pool: number): number {
  return Math.round(pool * (1 - PLATFORM_FEE_RATE));
}

/** 1st/2nd place split of a winner pool, rounded the same way the server rounds it
 *  (1st gets FIRST_PLACE_SHARE, 2nd gets the exact remainder — nothing left unclaimed).
 *  Squad format only — a duel's sole winner just takes the whole winnerPayoutTotal. */
export function splitWinnerPayout(winnerPayoutTotal: number): { first: number; second: number } {
  const first = Math.round(winnerPayoutTotal * FIRST_PLACE_SHARE);
  return { first, second: winnerPayoutTotal - first };
}

export interface ArenaUser {
  id: string;
  name: string;
  walletBalance: number;
  createdAt: number;
}

export interface ArcadeQuestionPublic {
  id: string;
  kind: GameKind;
  memorizeMs: number;
  answerMs: number;
  prompt: unknown;
  options: unknown[];
}

export type RoomStatus = 'waiting' | 'countdown' | 'live' | 'finished';

export interface RoomPlayerPublic {
  userId: string;
  name: string;
  ready: boolean;
  score: number;
  chancesLeft: number;
  connected: boolean;
}

export interface RoomSummary {
  id: string;
  gameKind: GameKind;
  format: RoomFormat;
  entryFee: number;
  status: RoomStatus;
  playerCount: number;
  maxPlayers: number;
}

export interface RoomStatePublic {
  id: string;
  gameKind: GameKind;
  format: RoomFormat;
  entryFee: number;
  status: RoomStatus;
  pool: number;
  players: RoomPlayerPublic[];
  countdownEndsAt: number | null;
  matchEndsAt: number | null;
}

export interface MatchResultPlayer {
  userId: string;
  name: string;
  score: number;
  correct: number;
  wrong: number;
  payout: number;
  isWinner: boolean;
}

export interface MatchResultPublic {
  roomId: string;
  gameKind: GameKind;
  format: RoomFormat;
  entryFee: number;
  pool: number;
  platformCut: number;
  winnerPayoutTotal: number;
  isVoidMatch: boolean;
  results: MatchResultPlayer[];
}

// --- The single game kind's prompt/option payload shape (for the renderer) -
export interface MemoryMatchPayload {
  assetId: string;
}

// --- Wallet ledger --------------------------------------------------------
export type TransactionType = 'topup' | 'withdrawal' | 'entry_fee' | 'refund' | 'payout' | 'platform_fee' | 'signup_bonus';

export interface Transaction {
  id: string;
  userId: string;
  type: TransactionType;
  amount: number;
  roomId?: string;
  balanceAfter: number;
  timestamp: number;
}

/** Lifetime profile stats derived from a user's full transaction ledger — powers the
 *  Profile screen. Mirrors server/src/types.ts. */
export interface WalletStats {
  memberSince: number;
  matchesPlayed: number;
  wins: number;
  totalWagered: number;
  totalWon: number;
  totalRefunded: number;
  totalDeposited: number;
  totalWithdrawn: number;
  netGameProfit: number;
}

/** A stable, wallet-address-style id for flavor — purely cosmetic, derived from the guest
 *  account id (never a real crypto address; this product never touches real currency). */
export function coinWalletId(userId: string): string {
  return `ARC-${userId.slice(0, 10).toUpperCase()}`;
}

/** 1-2 letter avatar initials derived from a display name (e.g. "Alex Rivera" -> "AR"). */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return '?';
  const last = parts[parts.length - 1];
  if (!last || last === first) return first.slice(0, 2).toUpperCase();
  return (first.charAt(0) + last.charAt(0)).toUpperCase();
}

export const TRANSACTION_LABELS: Record<TransactionType, string> = {
  topup: 'Deposit',
  withdrawal: 'Withdrawal',
  entry_fee: 'Entry fee',
  refund: 'Refund',
  payout: 'Match payout',
  platform_fee: 'Platform fee',
  signup_bonus: 'Welcome bonus',
};
