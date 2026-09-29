/** Core domain types shared across auth, the wallet, the room manager, and game kinds.
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
export function getRoundMemorizeMs(): number {
  return Number(process.env.ARCADE_ROUND_MEMORIZE_MS) || 1_800;
}
export function getRoundAnswerMs(): number {
  return Number(process.env.ARCADE_ROUND_ANSWER_MS) || 4_200;
}
export const STARTING_CHANCES = 5;

/** The minimum time a real, honest client can possibly take to notice the options and tap
 *  one — anything faster than this is physically implausible for a human and is rejected
 *  server-side. This is what actually bounds round throughput (not the client's UI), and is
 *  the fix for the previously-unbounded "173,312 answers in 60 seconds" bot exploit: a full
 *  round can never resolve faster than memorizeMs + MIN_REACTION_MS, regardless of what the
 *  client does. See rooms.ts. */
export const MIN_REACTION_MS = 150;

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

// ---------------------------------------------------------------------------
// Accounts & auth. `passwordHash` and `usernameKey` are server-internal only
// and must never be serialized to a client response — see `toPublicUser()`
// in wallet.ts, which is the single choke point every route must use.
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  /** Normalized (trimmed + lowercased) display name, used as the unique login key so
   *  "User", "USER", and "user" can never become three different accounts. Never sent
   *  to the client. */
  usernameKey: string;
  /** Original-casing display name shown in the UI. */
  name: string;
  /** `scrypt` salt:hash, e.g. "a1b2c3...:d4e5f6...". Never sent to the client. */
  passwordHash: string;
  walletBalance: number;
  createdAt: number;
}

/** The only user shape ever allowed to leave the server. */
export interface PublicUser {
  id: string;
  name: string;
  walletBalance: number;
  createdAt: number;
}

export type TransactionType = 'topup' | 'withdrawal' | 'entry_fee' | 'refund' | 'payout' | 'platform_fee' | 'signup_bonus';

/** Full transaction lifecycle. Every transaction recorded by this demo ledger today
 *  completes synchronously and is stored as 'completed' immediately — but the type
 *  models the complete state machine a real payment provider integration would need
 *  (a webhook-driven UPI/crypto deposit would sit in 'pending'/'processing' first). */
export type TransactionStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'expired' | 'reversed';

export interface Transaction {
  id: string;
  userId: string;
  type: TransactionType;
  amount: number;
  roomId?: string;
  balanceAfter: number;
  timestamp: number;
  status: TransactionStatus;
}

/** Lifetime profile stats derived from a user's full transaction ledger (never capped to
 *  the last N entries the wallet ledger UI shows) — powers the Profile screen. */
export interface WalletStats {
  memberSince: number;
  matchesPlayed: number;
  wins: number;
  totalWagered: number;
  totalWon: number;
  totalRefunded: number;
  totalDeposited: number;
  totalWithdrawn: number;
  /** Net gaming profit/loss: totalWon + totalRefunded - totalWagered (deposits/withdrawals excluded — they just move money in/out, they aren't gaming outcomes). */
  netGameProfit: number;
}

// ---------------------------------------------------------------------------
// Game rounds. A round is split into two server-timed phases delivered as two
// separate events (TARGET_REVEAL, then ANSWER_PHASE) instead of one payload
// that contains both the target and the options at once. The client submits
// only the opaque `token` of the option it picked; the server alone knows
// which token is correct (`GeneratedRound.correctToken` never leaves it).
// See rooms.ts for the full round state machine and timing enforcement.
// ---------------------------------------------------------------------------

export interface RoundOptionPublic {
  /** Opaque, freshly-random per round — NOT an index, NOT the asset id. This is what the
   *  client must echo back in match:answer; the server checks it against the round's own
   *  stored `correctToken`, never against anything the client asserts is "correct". */
  token: string;
  /** Needed so the client can actually render the candidate image. Yes, an attacker who
   *  keeps a copy of the TARGET_REVEAL event and compares it against this event's assetIds
   *  can still algorithmically determine the correct token without genuinely memorizing —
   *  this is an inherent limitation of any client that must render a shared, finite,
   *  bundled image set for both the prompt and the options (see AUDIT_REPORT.md /
   *  SECURITY_REPORT.md for the honest discussion). What this design *does* remove is the
   *  single-payload, one-line trivial match, and — far more importantly — it caps how many
   *  rounds can ever be completed per second, which is what actually made the old exploit
   *  dangerous (100% "accuracy" at unlimited speed). */
  assetId: string;
}

export interface GeneratedRound {
  targetAssetId: string;
  options: RoundOptionPublic[];
  /** Server-internal only — never included in any client-facing payload. */
  correctToken: string;
}

export interface RoundRevealPublic {
  roundId: string;
  kind: GameKind;
  memorizeMs: number;
  /** Authoritative — the client's own timer is cosmetic; this is what the server enforces. */
  revealDeadline: number;
  prompt: unknown;
}

export interface RoundOptionsPublic {
  roundId: string;
  kind: GameKind;
  answerMs: number;
  /** Authoritative deadline — an answer arriving after this is rejected, not just ignored. */
  answerDeadline: number;
  /** Authoritative earliest acceptable answer time — anything faster is physically
   *  implausible for a human and is rejected. */
  minAnswerAt: number;
  options: RoundOptionPublic[];
}

export interface RoundTimeoutPublic {
  roundId: string;
  /** Safe to reveal now — the round is already over and the token was freshly random for
   *  this round only, so revealing it teaches an attacker nothing about future rounds. */
  correctToken: string;
}

export type RoomStatus = 'waiting' | 'countdown' | 'live' | 'finished';

/** One player's currently in-flight round, tracked server-side only. */
export interface ActiveRound {
  roundId: string;
  phase: 'reveal' | 'answer';
  correctToken: string;
  dispatchedAt: number;
  revealDeadline: number;
  answerDeadline: number;
  minAnswerAt: number;
  resolved: boolean;
  advanceTimer: NodeJS.Timeout | null;
  expireTimer: NodeJS.Timeout | null;
}

export interface RoomPlayer {
  userId: string;
  /** Random per-room-join id shown to every OTHER occupant instead of the real account id
   *  (see rooms.ts toPlayerPublic) — a player's own entry still carries their real `userId`
   *  so the client can tell which seat is theirs. */
  publicId: string;
  name: string;
  socketId: string;
  ready: boolean;
  score: number;
  chancesLeft: number;
  correct: number;
  wrong: number;
  lastAnswerAt: number | null;
  connected: boolean;
  activeRound: ActiveRound | null;
}

export interface RoomPlayerPublic {
  /** The viewer's own real userId if this entry is them, otherwise the room-scoped opaque
   *  `publicId` — see rooms.ts. Never the other occupants' real account id. */
  id: string;
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
  /** Same self-vs-others opaque-id rule as RoomPlayerPublic. */
  id: string;
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
