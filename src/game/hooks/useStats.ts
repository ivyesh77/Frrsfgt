import { useCallback, useState } from 'react';
import type { GameResult, StoredStats } from '../../types';
import { loadStats, resetStats, saveStats } from '../../utils/storage';

export function useStats() {
  const [stats, setStats] = useState<StoredStats>(() => loadStats());

  const recordGame = useCallback((result: GameResult) => {
    setStats((prev) => {
      const next: StoredStats = {
        bestScore: Math.max(prev.bestScore, result.finalScore),
        bestStreak: Math.max(prev.bestStreak, result.bestStreak),
        gamesPlayed: prev.gamesPlayed + 1,
        totalCorrect: prev.totalCorrect + result.correct,
        totalWrong: prev.totalWrong + result.wrong,
      };
      saveStats(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setStats(resetStats());
  }, []);

  return { stats, recordGame, reset };
}
