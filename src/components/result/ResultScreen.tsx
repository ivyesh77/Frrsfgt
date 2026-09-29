import { motion } from 'framer-motion';
import type { GameResult } from '../../types';
import { Button } from '../common/Button';
import { AnimatedNumber } from '../common/AnimatedNumber';
import { ParticleBurst } from '../common/ParticleBurst';
import './ResultScreen.css';

interface ResultScreenProps {
  result: GameResult;
  reducedMotion: boolean;
  onPlayAgain: () => void;
  onMenu: () => void;
}

function formatSeconds(ms: number | null): string {
  if (ms === null) return '—';
  return `${(ms / 1000).toFixed(2)}s`;
}

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.15 } },
};

const item = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.2, 0.9, 0.32, 1] as const } },
};

export function ResultScreen({ result, reducedMotion, onPlayAgain, onMenu }: ResultScreenProps) {
  const accuracyPct = Math.round(result.accuracy * 100);

  return (
    <div className="result-screen no-select">
      <motion.div
        className="result-screen__card glass-panel"
        variants={container}
        initial="hidden"
        animate="show"
      >
        <motion.p className="result-screen__eyebrow" variants={item}>
          GAME COMPLETE
        </motion.p>

        <motion.div className="result-screen__score-wrap" variants={item}>
          {result.isNewBestScore && !reducedMotion && (
            <ParticleBurst variant="success" count={16} reducedMotion={reducedMotion} />
          )}
          <span className="result-screen__score">
            <AnimatedNumber value={result.finalScore} duration={0.9} />
          </span>
          <span className="result-screen__score-label">Final Score</span>
        </motion.div>

        {result.isNewBestScore && (
          <motion.div className="result-screen__badge" variants={item}>
            ✨ NEW BEST SCORE!
          </motion.div>
        )}

        <motion.div className="result-screen__grid" variants={item}>
          <div className="result-screen__stat">
            <span className="result-screen__stat-icon result-screen__stat-icon--good">✓</span>
            <span className="result-screen__stat-value">{result.correct}</span>
            <span className="result-screen__stat-label">Correct</span>
          </div>
          <div className="result-screen__stat">
            <span className="result-screen__stat-icon result-screen__stat-icon--bad">✕</span>
            <span className="result-screen__stat-value">{result.wrong}</span>
            <span className="result-screen__stat-label">Wrong</span>
          </div>
          <div className="result-screen__stat">
            <span className="result-screen__stat-icon result-screen__stat-icon--warn">⏱</span>
            <span className="result-screen__stat-value">{result.timeouts}</span>
            <span className="result-screen__stat-label">Timeout</span>
          </div>
          <div className="result-screen__stat">
            <span className="result-screen__stat-icon">🎯</span>
            <span className="result-screen__stat-value">{accuracyPct}%</span>
            <span className="result-screen__stat-label">Accuracy</span>
          </div>
        </motion.div>

        <motion.div className="result-screen__secondary" variants={item}>
          <div className="result-screen__secondary-item">
            <span>🔥 Best Streak</span>
            <strong>{result.bestStreak}</strong>
          </div>
          <div className="result-screen__secondary-item">
            <span>⚡ Avg Response</span>
            <strong>{formatSeconds(result.averageResponseMs)}</strong>
          </div>
          <div className="result-screen__secondary-item">
            <span>🏆 Fastest</span>
            <strong>{formatSeconds(result.fastestResponseMs)}</strong>
          </div>
          <div className="result-screen__secondary-item">
            <span>🥇 Best Score</span>
            <strong>{Math.max(result.previousBestScore, result.finalScore).toLocaleString()}</strong>
          </div>
        </motion.div>

        <motion.div className="result-screen__actions" variants={item}>
          <Button variant="primary" size="lg" onClick={onPlayAgain}>
            PLAY AGAIN
          </Button>
          <Button variant="secondary" size="lg" onClick={onMenu}>
            MENU
          </Button>
        </motion.div>
      </motion.div>
    </div>
  );
}
