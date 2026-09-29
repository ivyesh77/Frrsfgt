import { motion } from 'framer-motion';
import type { AnswerOption } from '../../types';
import { ImageTile } from '../common/ImageTile';
import { ParticleBurst } from '../common/ParticleBurst';
import { ANSWER_ENTRANCE_MS } from '../../game/engine/constants';
import './AnswerCard.css';

export type AnswerCardVisualState = 'default' | 'correct-selected' | 'wrong-selected' | 'correct-revealed' | 'dim';

const POSITION_LABELS = ['top left', 'top right', 'bottom left', 'bottom right'];

interface AnswerCardProps {
  option: AnswerOption;
  visualState: AnswerCardVisualState;
  interactive: boolean;
  reducedMotion: boolean;
  onSelect: (position: number) => void;
}

export function AnswerCard({ option, visualState, interactive, reducedMotion, onSelect }: AnswerCardProps) {
  const label = POSITION_LABELS[option.position] ?? 'answer';

  return (
    <motion.button
      type="button"
      className={`answer-card answer-card--${visualState}`}
      disabled={!interactive}
      aria-label={`${label} option`}
      aria-disabled={!interactive}
      onClick={() => onSelect(option.position)}
      initial={reducedMotion ? false : { opacity: 0, scale: 0.7, y: 10 }}
      animate={
        visualState === 'wrong-selected' && !reducedMotion
          ? { opacity: 1, scale: 1, y: 0, x: [0, -8, 8, -6, 6, 0] }
          : { opacity: 1, scale: visualState === 'correct-selected' ? 1.06 : 1, y: 0 }
      }
      transition={{
        duration: visualState === 'wrong-selected' ? 0.45 : ANSWER_ENTRANCE_MS / 1000,
        ease: [0.2, 0.9, 0.32, 1],
      }}
      whileHover={interactive ? { scale: 1.045 } : undefined}
      whileTap={interactive ? { scale: 0.95 } : undefined}
    >
      <ImageTile asset={option.asset} className="answer-card__tile" />
      {visualState === 'correct-selected' && (
        <>
          <div className="answer-card__ring answer-card__ring--success" />
          <ParticleBurst variant="success" reducedMotion={reducedMotion} />
        </>
      )}
      {visualState === 'wrong-selected' && <div className="answer-card__ring answer-card__ring--danger" />}
      {visualState === 'correct-revealed' && (
        <div className="answer-card__badge" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M5 13l4 4L19 7" stroke="#0b1f14" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}
    </motion.button>
  );
}
