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
