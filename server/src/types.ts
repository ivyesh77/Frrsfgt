/** Core domain types shared across the wallet, room manager, and game kinds. */

export type GameKind =
  | 'memoryMatch'
  | 'quickMath'
  | 'colorMatch'
  | 'emojiMatch'
  | 'oddOneOut'
  | 'numberSequence'
  | 'wordScramble'
  | 'shapeMatch'
  | 'patternRecall'
  | 'reactionTap';

export const GAME_KINDS: GameKind[] = [
  'memoryMatch',
  'quickMath',
  'colorMatch',
  'emojiMatch',
  'oddOneOut',
  'numberSequence',
  'wordScramble',
  'shapeMatch',
  'patternRecall',
  'reactionTap',
];

/** Fixed room stake tiers, in virtual currency units (mirrors ₹10 - ₹10,000). */
export const ENTRY_FEE_TIERS = [10, 50, 100, 500, 1000, 5000, 10000] as const;
export type EntryFee = (typeof ENTRY_FEE_TIERS)[number];

// Read lazily (not baked into a module-level const) so the self-test suite
// can shorten match/countdown durations via env vars regardless of ESM
// module-evaluation order; production simply never sets these env vars and
// always gets the real 60s/5s defaults.
export function getMatchDurationMs(): number {
  return Number(process.env.ARCADE_MATCH_DURATION_MS) || 60_000;
}
export function getReadyCountdownMs(): number {
  return Number(process.env.ARCADE_READY_COUNTDOWN_MS) || 5_000;
}
export const STARTING_CHANCES = 5;
export const MIN_PLAYERS_TO_START = 2;
export const MAX_PLAYERS_PER_ROOM = 8;
export const PLATFORM_FEE_RATE = 0.2; // 20% platform cut, 80% to the winner(s)
export const STARTING_WALLET_BALANCE = 1000;

export interface User {
  id: string;
  name: string;
  walletBalance: number;
  createdAt: number;
}

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

/** A single generated question. `correctIndex` never leaves the server. */
export interface ArcadeQuestion<TPrompt = unknown, TOption = unknown> {
  id: string;
  kind: GameKind;
  memorizeMs: number;
  answerMs: number;
  prompt: TPrompt;
  options: TOption[];
}

export interface ArcadeQuestionPublic {
  id: string;
  kind: GameKind;
  memorizeMs: number;
  answerMs: number;
  prompt: unknown;
  options: unknown[];
}

export interface GeneratedQuestion {
  question: ArcadeQuestionPublic;
  correctIndex: number;
}

export type RoomStatus = 'waiting' | 'countdown' | 'live' | 'finished';

export interface RoomPlayer {
  userId: string;
  name: string;
  socketId: string;
  ready: boolean;
  score: number;
  chancesLeft: number;
  correct: number;
  wrong: number;
  lastAnswerAt: number | null;
  connected: boolean;
  currentQuestionId?: string;
}

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
  /** True when nobody scored a single point — every entry fee was refunded, no platform cut taken. */
  isVoidMatch: boolean;
  results: MatchResultPlayer[];
}
