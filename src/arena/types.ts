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

/** Mirrors server/src/types.ts — used purely for client-side display math
 *  (e.g. showing a room's potential win amount before joining). The server
 *  is always the source of truth for the real payout at match end. */
export const PLATFORM_FEE_RATE = 0.2; // 20% platform cut, 80% to the winner(s)
export const MAX_PLAYERS_PER_ROOM = 8;
export const MIN_PLAYERS_TO_START = 2;

/** Winner's take of a pool of this size, rounded the same way the server rounds it. */
export function winnerShareOf(pool: number): number {
  return Math.round(pool * (1 - PLATFORM_FEE_RATE));
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
  entryFee: number;
  status: RoomStatus;
  playerCount: number;
  maxPlayers: number;
}

export interface RoomStatePublic {
  id: string;
  gameKind: GameKind;
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
export type TransactionType = 'topup' | 'entry_fee' | 'refund' | 'payout' | 'platform_fee';

export interface Transaction {
  id: string;
  userId: string;
  type: TransactionType;
  amount: number;
  roomId?: string;
  balanceAfter: number;
  timestamp: number;
}

export const TRANSACTION_LABELS: Record<TransactionType, string> = {
  topup: 'Top-up',
  entry_fee: 'Entry fee',
  refund: 'Refund',
  payout: 'Match payout',
  platform_fee: 'Platform fee',
};
