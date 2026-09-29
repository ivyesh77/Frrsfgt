import type { GameResult, RoundOutcome, ScoreState } from '../../types';
import { BASE_CORRECT_POINTS, MAX_SPEED_BONUS, STREAK_BONUS_PER_LEVEL } from './constants';

export function createInitialScoreState(): ScoreState {
  return {
    score: 0,
    correct: 0,
    wrong: 0,
    timeouts: 0,
    streak: 0,
    bestStreak: 0,
    responseTimes: [],
  };
}

/**
 * Deterministic scoring formula for a single round.
 *   correct:  100 base + up to 100 speed bonus (faster = higher) + 10 * new streak,
 *             scaled by the round's difficulty multiplier.
 *   wrong / timeout: 0 points, streak resets.
 */
export function computeRoundPoints(params: {
  outcome: RoundOutcome;
  responseMs: number | null;
  answerMs: number;
  streakAfter: number;
  scoreMultiplier: number;
}): number {
  const { outcome, responseMs, answerMs, streakAfter, scoreMultiplier } = params;
  if (outcome !== 'correct' || responseMs === null) return 0;

  const speedRatio = 1 - responseMs / answerMs;
  const speedBonus = Math.round(Math.max(0, Math.min(1, speedRatio)) * MAX_SPEED_BONUS);
  const streakBonus = STREAK_BONUS_PER_LEVEL * streakAfter;

  return Math.round((BASE_CORRECT_POINTS + speedBonus + streakBonus) * scoreMultiplier);
}

/** Applies a round's outcome to the running score state, returning a new state. */
export function applyRoundResult(
  state: ScoreState,
  outcome: RoundOutcome,
  responseMs: number | null,
  pointsEarned: number,
): ScoreState {
  const streak = outcome === 'correct' ? state.streak + 1 : 0;
  return {
    score: state.score + pointsEarned,
    correct: state.correct + (outcome === 'correct' ? 1 : 0),
    wrong: state.wrong + (outcome === 'wrong' ? 1 : 0),
    timeouts: state.timeouts + (outcome === 'timeout' ? 1 : 0),
    streak,
    bestStreak: Math.max(state.bestStreak, streak),
    responseTimes: responseMs !== null ? [...state.responseTimes, responseMs] : state.responseTimes,
  };
}

export function buildGameResult(
  state: ScoreState,
  totalDurationMs: number,
  previousBestScore: number,
  previousBestStreak: number,
): GameResult {
  // Accuracy is correct / total rounds played (correct + wrong + timeouts),
  // matching e.g. 17 correct out of 20 rounds => 85% shown on the result screen.
  const totalRounds = state.correct + state.wrong + state.timeouts;
  const accuracy = totalRounds > 0 ? state.correct / totalRounds : 0;
  const times = state.responseTimes;
  const averageResponseMs = times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : null;
  const fastestResponseMs = times.length > 0 ? Math.min(...times) : null;

  return {
    finalScore: state.score,
    correct: state.correct,
    wrong: state.wrong,
    timeouts: state.timeouts,
    accuracy,
    bestStreak: state.bestStreak,
    averageResponseMs,
    fastestResponseMs,
    totalDurationMs,
    isNewBestScore: state.score > previousBestScore,
    isNewBestStreak: state.bestStreak > previousBestStreak,
    previousBestScore,
  };
}
