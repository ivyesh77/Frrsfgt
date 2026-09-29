/** Broad content categories used to group assets and drive distractor similarity. */
export type AssetCategory =
  | 'animals'
  | 'food'
  | 'fruits'
  | 'vegetables'
  | 'objects'
  | 'vehicles'
  | 'nature'
  | 'household'
  | 'toys'
  | 'sports'
  | 'symbols';

/** Metadata describing a single playable image asset used in the memory game. */
export interface AssetMetadata {
  id: string;
  category: AssetCategory;
  name: string;
  tags: string[];
  /** Accent gradient used for the tile background behind the image. */
  accent: [string, string];
  /** Resolved, bundler-processed image URL. */
  src: string;
}

export type DifficultyTier = 'easy' | 'breezy' | 'medium' | 'hard' | 'veryHard' | 'final';

export interface DifficultyConfig {
  tier: DifficultyTier;
  /** How long the target is visible to memorize, in ms. */
  memorizeMs: number;
  /** How long the player has to answer once options appear, in ms. */
  answerMs: number;
  /** 0..1 probability that a distractor is pulled from the target's own category. */
  similarity: number;
  /** Scoring multiplier applied to points earned this round. */
  scoreMultiplier: number;
}

export interface AnswerOption {
  position: number; // 0=TL 1=TR 2=BL 3=BR
  asset: AssetMetadata;
  isCorrect: boolean;
}

export interface Round {
  index: number; // 1-based round number
  tier: DifficultyTier;
  target: AssetMetadata;
  options: AnswerOption[];
  correctPosition: number;
  memorizeMs: number;
  answerMs: number;
  scoreMultiplier: number;
}

export type RoundOutcome = 'correct' | 'wrong' | 'timeout';

export interface RoundResult {
  round: number;
  outcome: RoundOutcome;
  responseMs: number | null;
  pointsEarned: number;
  selectedPosition: number | null;
}

/** The single authoritative state machine driving the whole play session. */
export type GamePhase =
  | 'MENU'
  | 'ROUND_INITIALIZING'
  | 'TARGET_REVEAL'
  | 'MEMORIZING'
  | 'TARGET_HIDDEN'
  | 'ANSWERING'
  | 'ANSWER_SELECTED'
  | 'FEEDBACK_CORRECT'
  | 'FEEDBACK_WRONG'
  | 'FEEDBACK_TIMEOUT'
  | 'NEXT_ROUND'
  | 'GAME_COMPLETE'
  | 'PAUSED';

export interface ScoreState {
  score: number;
  correct: number;
  wrong: number;
  timeouts: number;
  streak: number;
  bestStreak: number;
  responseTimes: number[];
}

export interface GameResult {
  finalScore: number;
  correct: number;
  wrong: number;
  timeouts: number;
  accuracy: number;
  bestStreak: number;
  averageResponseMs: number | null;
  fastestResponseMs: number | null;
  totalDurationMs: number;
  isNewBestScore: boolean;
  isNewBestStreak: boolean;
  previousBestScore: number;
}

export interface Settings {
  sound: boolean;
  music: boolean;
  haptics: boolean;
  reducedMotion: boolean;
}

export interface StoredStats {
  bestScore: number;
  bestStreak: number;
  gamesPlayed: number;
  totalCorrect: number;
  totalWrong: number;
}

export type AppScreen = 'menu' | 'game' | 'result';
