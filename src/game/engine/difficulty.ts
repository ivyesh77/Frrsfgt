import type { DifficultyConfig } from '../../types';

/**
 * Maps a 1-based round number (1..20) to a difficulty configuration. Difficulty
 * ramps by shortening timers and increasing distractor similarity — never by
 * introducing unfair randomness.
 */
export function getDifficultyForRound(round: number): DifficultyConfig {
  if (round <= 4) {
    return { tier: 'easy', memorizeMs: 3400, answerMs: 6000, similarity: 0.1, scoreMultiplier: 1 };
  }
  if (round <= 8) {
    return { tier: 'breezy', memorizeMs: 2800, answerMs: 5200, similarity: 0.35, scoreMultiplier: 1.05 };
  }
  if (round <= 12) {
    return { tier: 'medium', memorizeMs: 2300, answerMs: 4500, similarity: 0.55, scoreMultiplier: 1.1 };
  }
  if (round <= 16) {
    return { tier: 'hard', memorizeMs: 1850, answerMs: 3800, similarity: 0.75, scoreMultiplier: 1.15 };
  }
  if (round <= 19) {
    return { tier: 'veryHard', memorizeMs: 1500, answerMs: 3200, similarity: 0.85, scoreMultiplier: 1.2 };
  }
  return { tier: 'final', memorizeMs: 1350, answerMs: 3000, similarity: 0.9, scoreMultiplier: 1.3 };
}
