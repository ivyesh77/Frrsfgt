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
// always gets the real defaults below.
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
/** How long a full lobby waits for every seated player to ready up before the server
 *  cancels the match and refunds everyone (see rooms.ts `startReadyCheck`). */
export function getLobbyReadyTimeoutMs(): number {
  return Number(process.env.ARCADE_LOBBY_READY_TIMEOUT_MS) || 45_000;
}
/** How long a disconnected player's seat is held (rounds paused, not force-advanced) before
 *  the server treats them as having forfeited the match (see rooms.ts `handleDisconnect`). */
export function getReconnectGraceMs(): number {
  return Number(process.env.ARCADE_RECONNECT_GRACE_MS) || 20_000;
}

/** The minimum time a real, honest client can possibly take to notice the options and tap
 *  one — anything faster than this is physically implausible for a human and is rejected
 *  server-side. This is what actually bounds round throughput (not the client's UI), and is
 *  the fix for the previously-unbounded "173,312 answers in 60 seconds" bot exploit: a full
 *  round can never resolve faster than memorizeMs + MIN_REACTION_MS, regardless of what the
 *  client does. See rooms.ts. */
export const MIN_REACTION_MS = 150;

// Every room is one of two fixed formats that only start once completely full:
// a 1v1 duel or a 1v1v1v1 (4-player) squad. Both share the exact same core gameplay
// (one center target, four corner options, +1/-1 scoring, one overall match timer) — the
// only difference is player count and how the final standings are presented/paid out.
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
  { id: 'squad', label: '1v1v1v1 Squad', players: 4, winnerCount: 2 },
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
// non-scoring "2nd place". Duels never split — the sole winner takes it all.
export const FIRST_PLACE_SHARE = 0.6;
export const STARTING_WALLET_BALANCE = 1000;

// ---------------------------------------------------------------------------
// Player notification center. Real events only — generated at the exact point a real
// thing happens server-side (wallet credited/debited, match found, match result known) —
// never fabricated to make the notification center look busier than the account's real
// activity. See notifications.ts for every place one of these is actually created.
// ---------------------------------------------------------------------------
export type NotificationType = 'game' | 'match' | 'wallet' | 'payment' | 'security' | 'system';

export interface NotificationEntry {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  createdAt: number;
  read: boolean;
  meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Accounts & auth. `passwordHash` and `usernameKey` are server-internal only
// and must never be serialized to a client response — see `toPublicUser()`
// in wallet.ts, which is the single choke point every route must use.
// ---------------------------------------------------------------------------

/** Account standing, settable only by an authorized admin action (see server/src/admin/
 *  users.ts) — never client-settable in any form. `suspended` blocks login/gameplay
 *  temporarily and reversibly; `banned` is the harder, still-reversible-by-an-admin form.
 *  Both are enforced at the point of login (authenticateUser) AND by force-invalidating
 *  every existing session for that user the moment the action is taken, so an already
 *  logged-in tab cannot keep playing after a ban. */
export type AccountStatus = 'active' | 'suspended' | 'banned';

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
  /** Defaults to 'active' for every account created before this field existed — see
   *  store.ts loadDb() normalization. */
  status: AccountStatus;
}

/** The only user shape ever allowed to leave the server. */
export interface PublicUser {
  id: string;
  name: string;
  walletBalance: number;
  createdAt: number;
}

export type TransactionType = 'topup' | 'withdrawal' | 'entry_fee' | 'refund' | 'payout' | 'platform_fee' | 'signup_bonus' | 'admin_adjustment' | 'withdrawal_reservation' | 'withdrawal_release' | 'deposit_reversal';

/** Full transaction lifecycle. Existing gameplay/demo records complete synchronously;
 * payment-backed records use the same ledger with pending/processing transitions. */
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
  currency?: string;
  fee?: number;
  paymentTransactionId?: string;
  idempotencyKey?: string;
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

export interface RoundResultPublic {
  roundId: string;
  correct: boolean;
  /** Safe to reveal now — the round is already over and the token was single-use/random
   *  for this round only, so revealing it teaches an attacker nothing about future rounds. */
  correctToken: string;
  /** The caller's own new authoritative score, included purely so the client never has to
   *  (and never gets to) compute it locally — this is the server's number, not a delta the
   *  client applied itself. */
  score: number;
}

export interface RoundTimeoutPublic {
  roundId: string;
  correctToken: string;
  score: number;
}

// ---------------------------------------------------------------------------
// Matchmaking / room lifecycle. Explicit, narrow state machine — see rooms.ts for the
// guarded transition functions. A player-facing summary of "which stage am I at" is
// reconstructed by the client purely from this status plus the fields below; the client
// never invents or advances this state on its own.
//
//   queued      -> room created, still waiting for enough players (server-side matchmaking
//                  queue; the player did not choose an opponent or room id).
//   ready_check -> room is full; every occupant must send `rooms:ready` before a short
//                  server-owned timeout elapses, or the match is cancelled (refunded).
//   starting    -> everyone readied up; a server-owned 3-2-1-GO countdown is running.
//   active      -> the single overall match timer is running; rounds are being dispatched.
//   finished    -> the match timer elapsed (or every player forfeited) and results are final.
//   cancelled   -> the ready-check timed out before everyone readied; entry fees refunded.
// ---------------------------------------------------------------------------
export type RoomStatus = 'queued' | 'ready_check' | 'starting' | 'active' | 'finished' | 'cancelled';

/** One player's currently in-flight round, tracked server-side only. */
export interface ActiveRound {
  roundId: string;
  phase: 'reveal' | 'answer';
  correctToken: string;
  dispatchedAt: number;
  revealDeadline: number;
  answerDeadline: number;
  minAnswerAt: number;
  /** Server timestamp the answer phase actually began (options became visible) — the base
   *  point for a real, honest reaction-time measurement. Null while still in the reveal
   *  (memorize) phase. */
  optionsDispatchedAt: number | null;
  resolved: boolean;
  advanceTimer: NodeJS.Timeout | null;
  expireTimer: NodeJS.Timeout | null;
}

/** Mirrors real-world connection reality for a seated player. `disconnected` covers both
 *  "just dropped" and "actively trying to reconnect" — the client is expected to render
 *  both the same way ("reconnecting…") since the server doesn't need a distinct third wire
 *  state to make the right authoritative decision (see rooms.ts `handleDisconnect` /
 *  `getReconnectGraceMs`). `forfeited` is terminal for that player for the rest of the match. */
export type PlayerConnectionState = 'connected' | 'disconnected' | 'forfeited';

export interface RoomPlayer {
  userId: string;
  /** Random per-room-join id shown to every OTHER occupant instead of the real account id
   *  (see rooms.ts toPlayerPublic) — a player's own entry still carries their real `userId`
   *  so the client can tell which seat is theirs. */
  publicId: string;
  name: string;
  socketId: string;
  ready: boolean;
  /** Authoritative score: +1 per correct answer, -1 per wrong answer or timeout. Can go
   *  negative — there is no "elimination" mechanic; every seated player keeps playing
   *  every round until the single overall match timer ends. */
  score: number;
  correct: number;
  wrong: number;
  lastAnswerAt: number | null;
  connectionState: PlayerConnectionState;
  activeRound: ActiveRound | null;
  /** Server-owned grace timer started the instant this player disconnects mid-match; if it
   *  fires before they reconnect, they are marked `forfeited`. Never exposed to any client. */
  forfeitTimer: NodeJS.Timeout | null;
  /** Current consecutive-correct-answer run (resets to 0 on any wrong answer or timeout)
   *  and the highest it ever reached this match — both real, round-by-round tracked. */
  correctStreak: number;
  maxStreak: number;
  /** Running sum/count of real per-round reaction times (ms, answer-phase-start to actual
   *  submission) so a lifetime average can be computed without storing every round. */
  reactionMsSum: number;
  reactionCount: number;
  fastestReactionMs: number | null;
}

export interface RoomPlayerPublic {
  /** The viewer's own real userId if this entry is them, otherwise the room-scoped opaque
   *  `publicId` — see rooms.ts. Never the other occupants' real account id. */
  id: string;
  name: string;
  ready: boolean;
  score: number;
  connectionState: PlayerConnectionState;
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
  /** Set once `status` becomes `ready_check` — the server-owned deadline by which every
   *  occupant must have readied up, or the match is cancelled. */
  readyDeadline: number | null;
  /** Set once `status` becomes `starting` — the server-owned 3-2-1-GO countdown target. */
  startsAt: number | null;
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
  connectionState: PlayerConnectionState;
  /** Longest consecutive-correct-answer run this player reached during the match — real,
   *  tracked live round-by-round server-side (see rooms.ts), never computed/asserted by a
   *  client. Powers both the result screen's "performance stats" and streak achievements. */
  maxStreak: number;
  /** Average time (ms) from when this player's answer options actually became visible
   *  (server-timed) to when they submitted an answer, across every answered round this
   *  match. Null if they never answered a single round (e.g. every round timed out). */
  avgReactionMs: number | null;
  /** The single fastest of those reaction times this match. Null under the same condition
   *  as avgReactionMs. */
  fastestReactionMs: number | null;
}

/** Server-storage-only per-player snapshot of a finished/cancelled match, keyed by REAL
 *  userId (never redacted here — this never leaves the server directly; see
 *  playerHistory.ts for the per-viewer redaction applied at read time). Written once, the
 *  instant a match concludes, straight from the same authoritative numbers already
 *  computed for the real-time match:end payload — never a second, independently-derived
 *  copy that could drift from what players actually saw during the match. */
export interface MatchHistoryPlayerResult {
  userId: string;
  name: string;
  score: number;
  correct: number;
  wrong: number;
  payout: number;
  isWinner: boolean;
  connectionState: PlayerConnectionState;
  maxStreak: number;
  avgReactionMs: number | null;
  fastestReactionMs: number | null;
}

export interface MatchResultPublic {
  roomId: string;
  gameKind: GameKind;
  format: RoomFormat;
  entryFee: number;
  pool: number;
  platformCut: number;
  winnerPayoutTotal: number;
  /** True only when literally nobody in the match ever submitted a single answer (e.g.
   *  everyone disconnected immediately) — every entry fee is refunded, no platform cut taken. */
  isVoidMatch: boolean;
  /** Duel-only: true when both players finished with the exact same score — no winner is
   *  paid out, both entry fees are refunded (see payout.ts). Always false for squad matches,
   *  which always produce a strict 1st-4th ranking even when scores tie. */
  isDraw: boolean;
  /** Why the match ended — `timer` is the normal case; `forfeit` means every remaining
   *  opponent forfeited (disconnected past the reconnect grace window) before the timer
   *  elapsed, most relevant for a duel where one forfeit immediately decides the match.
   *  `admin_cancelled` means an authorized admin force-closed a broken/stuck match — always
   *  treated as a full void/refund, never a computed winner (see admin/rooms.ts — there is
   *  no "set winner" admin shortcut anywhere in this codebase). */
  endedBy: 'timer' | 'forfeit' | 'admin_cancelled';
  results: MatchResultPlayer[];
}
