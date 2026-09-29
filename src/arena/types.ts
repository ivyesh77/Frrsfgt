/**
 * Client-side mirror of the backend's wire types (server/src/types.ts).
 * The frontend and backend are separate TypeScript projects/runtimes (Vite
 * browser bundle vs. Node server), so there is no shared package to import
 * from — these shapes are kept in sync by hand. Keep field names identical
 * to the server so payloads can be used as-is without any mapping layer.
 */

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

export const GAME_KIND_LABELS: Record<GameKind, string> = {
  memoryMatch: 'Memory Match',
  quickMath: 'Quick Math',
  colorMatch: 'Color Match',
  emojiMatch: 'Emoji Match',
  oddOneOut: 'Odd One Out',
  numberSequence: 'Number Sequence',
  wordScramble: 'Word Scramble',
  shapeMatch: 'Shape Match',
  patternRecall: 'Pattern Recall',
  reactionTap: 'Reaction Tap',
};

export const GAME_KIND_TAGLINES: Record<GameKind, string> = {
  memoryMatch: 'Memorize the icon, then spot its twin.',
  quickMath: 'Solve the sum before time runs out.',
  colorMatch: 'Remember the swatch, pick it from four.',
  emojiMatch: 'Remember the emoji, find it again.',
  oddOneOut: 'Spot the tile that does not belong.',
  numberSequence: "Crack the pattern, guess what's next.",
  wordScramble: 'Unscramble the letters into a word.',
  shapeMatch: 'Remember the shape, pick it from four.',
  patternRecall: 'Memorize a short symbol sequence.',
  reactionTap: 'Wait for the flash, tap it first.',
};

export const GAME_KIND_ICONS: Record<GameKind, string> = {
  memoryMatch: '🧠',
  quickMath: '➗',
  colorMatch: '🎨',
  emojiMatch: '😀',
  oddOneOut: '🔍',
  numberSequence: '🔢',
  wordScramble: '🔤',
  shapeMatch: '🔷',
  patternRecall: '📿',
  reactionTap: '⚡',
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

// --- Per-game-kind option/prompt payload shapes (for the renderer) --------
export interface MemoryMatchPayload {
  assetId: string;
}
export interface QuickMathOption {
  value: number;
}
export interface QuickMathPrompt {
  expression: string;
}
export interface ColorPayload {
  color: string;
}
export interface EmojiPayload {
  emoji: string;
}
export interface ShapePayload {
  shape: string;
}
export interface SequencePayload {
  sequence: string[];
}
export interface NumberSequencePrompt {
  sequence: number[];
}
export interface WordScramblePrompt {
  scrambled: string;
}
export interface WordOption {
  word: string;
}
