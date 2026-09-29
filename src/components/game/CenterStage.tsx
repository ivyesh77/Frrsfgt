import { AnimatePresence, motion } from 'framer-motion';
import type { GamePhase, Round, RoundOutcome } from '../../types';
import { ImageTile } from '../common/ImageTile';
import { ProgressRing } from '../common/ProgressRing';
import './CenterStage.css';

interface CenterStageProps {
  phase: GamePhase;
  round: Round | null;
  phaseStartedAt: number;
  phaseDuration: number;
  paused: boolean;
  pendingOutcome: RoundOutcome | null;
  reducedMotion: boolean;
}

const OUTCOME_META: Record<RoundOutcome, { icon: string; label: string; className: string }> = {
  correct: { icon: '✓', label: 'Correct!', className: 'center-stage__outcome--correct' },
  wrong: { icon: '✕', label: 'Not quite', className: 'center-stage__outcome--wrong' },
  timeout: { icon: '⏱', label: "Time's up", className: 'center-stage__outcome--timeout' },
};

export function CenterStage({
  phase,
  round,
  phaseStartedAt,
  phaseDuration,
  paused,
  pendingOutcome,
  reducedMotion,
}: CenterStageProps) {
  return (
    <div className="center-stage">
      <AnimatePresence>
        {(phase === 'TARGET_REVEAL' || phase === 'MEMORIZING') && round && (
          <motion.div
            key="target"
            className="center-stage__frame"
            initial={reducedMotion ? false : { opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
            transition={{ duration: 0.26, ease: [0.2, 0.9, 0.32, 1] }}
          >
            <ImageTile asset={round.target} className="center-stage__tile" priority />
            {phase === 'MEMORIZING' && (
              <div className="center-stage__ring">
                <ProgressRing
                  startedAt={phaseStartedAt}
                  durationMs={phaseDuration}
                  size={148}
                  strokeWidth={5}
                  paused={paused}
                />
              </div>
            )}
            <span className="center-stage__caption">MEMORIZE</span>
          </motion.div>
        )}

        {phase === 'TARGET_HIDDEN' && (
          <motion.div
            key="hidden"
            className="center-stage__placeholder"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <span className="center-stage__pulse-dot" />
          </motion.div>
        )}

        {phase === 'ANSWERING' && round && (
          <motion.div
            key="answering"
            className="center-stage__placeholder"
            initial={reducedMotion ? false : { opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <ProgressRing
              startedAt={phaseStartedAt}
              durationMs={phaseDuration}
              size={120}
              strokeWidth={6}
              paused={paused}
            />
            <span className="center-stage__hint">FIND IT!</span>
          </motion.div>
        )}

        {(phase === 'ANSWER_SELECTED' || phase === 'FEEDBACK_CORRECT' || phase === 'FEEDBACK_WRONG' || phase === 'FEEDBACK_TIMEOUT') &&
          pendingOutcome && (
            <motion.div
              key="outcome"
              className={`center-stage__outcome ${OUTCOME_META[pendingOutcome].className}`}
              initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ type: 'spring', stiffness: 380, damping: 20 }}
            >
              <span className="center-stage__outcome-icon">{OUTCOME_META[pendingOutcome].icon}</span>
              <span className="center-stage__outcome-label">{OUTCOME_META[pendingOutcome].label}</span>
            </motion.div>
          )}
      </AnimatePresence>
    </div>
  );
}
