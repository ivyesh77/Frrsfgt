/** Core domain types shared across the wallet, room manager, and game kinds.
 *  This product ships a single game (Memory Match) — GameKind is kept as a
 *  named type (rather than inlining the literal everywhere) so a second game
 *  could be added later without reshaping every call site, but today it only
 *  ever has one value. */

export type GameKind = 'memoryMatch';

export const GAME_KINDS: GameKind[] = ['memoryMatch'];

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
// Every room is one of two fixed formats that only start once completely full:
// a 1v1 duel (winner takes the entire winner pool, loser gets nothing) or a
// 4-player squad match (top 2 scorers split the winner pool, bottom 2 win
// nothing). See FIRST_PLACE_SHARE below for the squad 1st/2nd split.
export type RoomFormat = 'duel' | 'squad';

export interface RoomFormatMeta {
  id: RoomFormat;
  label: string;
  /** Room capacity — matches also start only once this many players are seated. */
  players: number;
  /** How many top scorers are paid out (1 = winner takes all, 2 = 1st/2nd split). */
  winnerCount: number;
}

export const ROOM_FORMATS: RoomFormatMeta[] = [
  { id: 'duel', label: '1v1 Duel', players: 2, winnerCount: 1 },
  { id: 'squad', label: '4-Player Squad', players: 4, winnerCount: 2 },
];

export function roomFormatMeta(format: RoomFormat): RoomFormatMeta {
  const found = ROOM_FORMATS.find((f) => f.id === format);
  if (found) return found;
  const fallback = ROOM_FORMATS.find((f) => f.id === 'squad');
  if (!fallback) throw new Error('ROOM_FORMATS is missing the squad format'); // invariant: never actually empty
  return fallback;
}

export const PLATFORM_FEE_RATE = 0.2; // 20% platform cut, 80% to the winners
// Squad-format only: of the winner pool (winnerPayoutTotal), 1st place takes this
// share and 2nd place takes the remainder — e.g. 60/40. If only one player actually
// scored, they take the entire winner pool alone instead of splitting with a
// non-scoring "2nd place". Duels never split — the sole scorer takes it all.
export const FIRST_PLACE_SHARE = 0.6;
export const STARTING_WALLET_BALANCE = 1000;



export interface User {
  id: string;
  name: string;
  walletBalance: number;
  createdAt: number;
}

export type TransactionType = 'topup' | 'withdrawal' | 'entry_fee' | 'refund' | 'payout' | 'platform_fee';

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
  /** True when nobody scored a single point — every entry fee was refunded, no platform cut taken. */
  isVoidMatch: boolean;
  results: MatchResultPlayer[];
}
