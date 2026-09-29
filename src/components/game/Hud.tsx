import { motion } from 'framer-motion';
import { AnimatedNumber } from '../common/AnimatedNumber';
import { TOTAL_ROUNDS } from '../../game/engine/constants';
import './Hud.css';

interface HudProps {
  score: number;
  streak: number;
  roundNumber: number;
  onOpenSettings: () => void;
  soundOn: boolean;
  onToggleSound: () => void;
}

export function Hud({ score, streak, roundNumber, onOpenSettings, soundOn, onToggleSound }: HudProps) {
  const progress = Math.min(1, Math.max(0, (roundNumber - 1) / TOTAL_ROUNDS));

  return (
    <div className="hud">
      <div className="hud__row">
        <div className="hud__stat hud__stat--score">
          <span className="hud__label">Score</span>
          <span className="hud__value">
            <AnimatedNumber value={score} />
          </span>
        </div>

        <div className="hud__round">
          <span className="hud__round-label">
            Round {String(roundNumber).padStart(2, '0')} / {TOTAL_ROUNDS}
          </span>
          <div className="hud__progress-track">
            <motion.div
              className="hud__progress-fill"
              animate={{ width: `${progress * 100}%` }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
            />
          </div>
        </div>

        <div className={`hud__stat hud__stat--streak${streak >= 3 ? ' hud__stat--hot' : ''}`}>
          <span className="hud__label">Streak</span>
          <span className="hud__value">
            <span className="hud__flame" aria-hidden="true">
              🔥
            </span>
            <AnimatedNumber value={streak} duration={0.3} />
          </span>
        </div>
      </div>

      <div className="hud__controls">
        <button
          type="button"
          className="hud__icon-button"
          onClick={onToggleSound}
          aria-label={soundOn ? 'Mute sound' : 'Unmute sound'}
          aria-pressed={!soundOn}
        >
          {soundOn ? '🔊' : '🔇'}
        </button>
        <button type="button" className="hud__icon-button" onClick={onOpenSettings} aria-label="Open settings">
          ⚙️
        </button>
      </div>
    </div>
  );
}
