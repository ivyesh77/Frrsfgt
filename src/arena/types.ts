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

/** The minimum time a real human can plausibly take to react — mirrors server/src/types.ts
 *  MIN_REACTION_MS. The server is the sole authority that actually enforces this; the
 *  client only uses it to avoid submitting an answer the server would reject anyway. */
export const MIN_REACTION_MS = 150;

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

/** The only user shape the server ever sends — a real account with a hashed password
 *  behind it now, never a client-conjured "guest". Never carries a password or any other
 *  secret. */
export interface ArenaUser {
  id: string;
  name: string;
  walletBalance: number;
  createdAt: number;
}

/**
 * Server-authoritative match/lobby lifecycle (mirrors server/src/types.ts RoomStatus):
 *   queued      -> in the server-side matchmaking queue, waiting for enough players.
 *   ready_check -> the room is full; every occupant must send `rooms:ready` before a
 *                  server-owned deadline (`readyDeadline`), or the match is cancelled.
 *   starting    -> everyone readied up; a server-owned 3-2-1-GO countdown is running
 *                  (`startsAt`).
 *   active      -> the single overall match timer (`matchEndsAt`) is running.
 *   finished    -> the match is over; final results are in `match:end`.
 *   cancelled   -> the ready-check timed out before everyone readied; entry fees refunded.
 * The client only ever *renders* this — it never decides or advances it.
 */
export type RoomStatus = 'queued' | 'ready_check' | 'starting' | 'active' | 'finished' | 'cancelled';

/** Mirrors server/src/types.ts. `disconnected` covers both "just dropped" and "trying to
 *  reconnect" — rendered identically ("reconnecting…") since the server doesn't expose a
 *  separate wire state for that distinction. `forfeited` is terminal for that seat. */
export type PlayerConnectionState = 'connected' | 'disconnected' | 'forfeited';

/** `id` is the viewer's OWN real account id if this entry is them, otherwise a room-scoped
 *  opaque id — the server never reveals another occupant's real account id (see
 *  server/src/rooms.ts toPlayerPublic). Never assume `id` is a stable account identifier
 *  for anyone except yourself. */
export interface RoomPlayerPublic {
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
  readyDeadline: number | null;
  startsAt: number | null;
  matchEndsAt: number | null;
}

/** Same self-vs-opaque-id rule as RoomPlayerPublic. */
export interface MatchResultPlayer {
  id: string;
  name: string;
  score: number;
  correct: number;
  wrong: number;
  payout: number;
  isWinner: boolean;
  connectionState: PlayerConnectionState;
  /** Longest consecutive-correct-answer run this match — real, server-tracked round by round. */
  maxStreak: number;
  /** Average/fastest reaction time (ms, options-visible -> answer submitted), both server-
   *  measured. Null if this player never answered a single round. */
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
  isVoidMatch: boolean;
  /** Duel-only: both players finished with an identical score — no winner, full refund. */
  isDraw: boolean;
  endedBy: 'timer' | 'forfeit';
  results: MatchResultPlayer[];
}

// --- The single game kind's prompt/option payload shape (for the renderer) -
export interface MemoryMatchPayload {
  assetId: string;
}

// ---------------------------------------------------------------------------
// Two-phase, server-timed round protocol. A round always arrives as two SEPARATE events
// instead of one payload containing both the target and the options — see
// server/src/rooms.ts and AUDIT_REPORT.md for why the old single-payload shape leaked the
// correct answer. The client renders whatever it's given and submits only an opaque
// `token`; it never computes or asserts correctness itself.
// ---------------------------------------------------------------------------
export interface RoundOptionPublic {
  /** Opaque, freshly-random per round — this is what gets echoed back in match:answer.
   *  It is NOT an index and NOT the asset id, and carries no information about whether
   *  this option is correct. */
  token: string;
  assetId: string;
}

export interface RoundRevealPublic {
  roundId: string;
  kind: GameKind;
  memorizeMs: number;
  /** Authoritative — only used for the countdown animation; the server enforces the real deadline. */
  revealDeadline: number;
  prompt: unknown;
}

export interface RoundOptionsPublic {
  roundId: string;
  kind: GameKind;
  answerMs: number;
  answerDeadline: number;
  minAnswerAt: number;
  options: RoundOptionPublic[];
}

export interface RoundTimeoutPublic {
  roundId: string;
  correctToken: string;
  /** The caller's own new authoritative score after this timeout's -1 penalty — the server's
   *  number, never something the client computes itself. */
  score: number;
}

export interface RoundResultPublic {
  correct: boolean;
  correctToken: string;
  score: number;
}

// --- Wallet ledger --------------------------------------------------------
export type TransactionType = 'topup' | 'withdrawal' | 'entry_fee' | 'refund' | 'payout' | 'platform_fee' | 'signup_bonus';
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

/** A stable, wallet-address-style id for flavor — purely cosmetic, derived from the
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

// ---------------------------------------------------------------------------
// Game mode config (mirrors server/src/admin/flags.ts via GET /api/game-modes) — whether
// duel/squad is actually playable right now is always read from here, never hardcoded.
// ---------------------------------------------------------------------------
export interface GameModeMeta extends RoomFormatMeta {
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Match history (mirrors server/src/playerHistory.ts) — real, server-paginated/filtered.
// ---------------------------------------------------------------------------
export type MatchOutcome = 'win' | 'loss' | 'draw' | 'void';

export interface MatchHistoryOpponent {
  name: string;
  score: number;
  isWinner: boolean;
}

export interface MatchHistoryItem {
  roomId: string;
  format: RoomFormat;
  formatLabel: string;
  entryFee: number;
  status: 'finished' | 'cancelled';
  outcome: MatchOutcome;
  yourScore: number | null;
  yourCorrect: number | null;
  yourWrong: number | null;
  yourMaxStreak: number | null;
  yourPayout: number | null;
  placement: number | null;
  playerCount: number;
  opponents: MatchHistoryOpponent[];
  startedAt: number | null;
  endedAt: number;
  durationMs: number | null;
}

export interface PaginatedMatchHistory {
  items: MatchHistoryItem[];
  total: number;
  page: number;
  pageSize: number;
}

export const MATCH_OUTCOME_LABELS: Record<MatchOutcome, string> = {
  win: 'Win',
  loss: 'Loss',
  draw: 'Draw',
  void: 'Void (refunded)',
};

// ---------------------------------------------------------------------------
// Lifetime stats + achievements (mirrors server/src/playerStats.ts) — always computed
// fresh from real match/wallet history, never a client-side guess or placeholder.
// ---------------------------------------------------------------------------
export interface FormatStats {
  played: number;
  wins: number;
  losses: number;
  draws: number;
}

export interface PlayerStats {
  memberSince: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  highestScore: number;
  highestStreak: number;
  totalCorrect: number;
  totalWrong: number;
  averageScore: number;
  averageReactionMs: number | null;
  fastestReactionMs: number | null;
  byFormat: Record<RoomFormat, FormatStats>;
  totalWagered: number;
  totalWon: number;
  netGameProfit: number;
}

export type AchievementStatus = 'locked' | 'in_progress' | 'unlocked';

export interface Achievement {
  id: string;
  title: string;
  description: string;
  status: AchievementStatus;
  progress: { current: number; target: number };
  unlockedAt: number | null;
}

// ---------------------------------------------------------------------------
// Notifications (mirrors server/src/notifications.ts) — real events only.
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

export interface PaginatedNotifications {
  items: NotificationEntry[];
  total: number;
  unreadCount: number;
  page: number;
  pageSize: number;
}

export const NOTIFICATION_ICONS: Record<NotificationType, string> = {
  game: '🎮',
  match: '⚔️',
  wallet: '🪙',
  payment: '💳',
  security: '🔒',
  system: '📣',
};

// ---------------------------------------------------------------------------
// Payment methods (mirrors server/src/admin/payments.ts publicPaymentMethodsView) — always
// an honest reflection of what's actually enabled server-side, never a client guess.
// ---------------------------------------------------------------------------
export interface PublicPaymentMethods {
  demoWallet: { available: true; note: string };
  upi: { enabled: boolean; minAmount: number; maxAmount: number } | null;
  crypto: Array<{
    asset: string;
    network: string;
    depositEnabled: boolean;
    withdrawEnabled: boolean;
    minAmount: number;
    maxAmount: number;
    confirmationsRequired: number;
  }>;
}

// ---------------------------------------------------------------------------
// Support tickets (mirrors server/src/admin/types.ts SupportTicket, player-safe subset).
// ---------------------------------------------------------------------------
export type SupportTicketStatus = 'open' | 'in_progress' | 'waiting' | 'resolved' | 'closed';
export type SupportTicketCategory = 'account' | 'wallet' | 'payment' | 'gameplay' | 'other';

export interface SupportTicket {
  id: string;
  userId: string;
  userName: string;
  subject: string;
  message: string | null;
  category: SupportTicketCategory;
  status: SupportTicketStatus;
  createdAt: number;
  updatedAt: number;
  createdByAdminId: string | null;
}

export const SUPPORT_CATEGORY_LABELS: Record<SupportTicketCategory, string> = {
  account: 'Account',
  wallet: 'Wallet',
  payment: 'Payment',
  gameplay: 'Gameplay',
  other: 'Other',
};

export const SUPPORT_STATUS_LABELS: Record<SupportTicketStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  waiting: 'Waiting on you',
  resolved: 'Resolved',
  closed: 'Closed',
};
