import { AnimatePresence, motion } from 'framer-motion';
import type { GameEngineState } from '../../game/engine/gameReducer';
import { AnswerCard, type AnswerCardVisualState } from './AnswerCard';
import { CenterStage } from './CenterStage';
import './GameArena.css';

interface GameArenaProps {
  engine: GameEngineState;
  reducedMotion: boolean;
  onSelect: (position: number) => void;
}

const CELL_AREAS = ['tl', 'tr', 'bl', 'br'];

function computeVisualState(
  position: number,
  isCorrect: boolean,
  phase: GameEngineState['phase'],
  selectedPosition: number | null,
): AnswerCardVisualState {
  const feedbackPhases = new Set(['ANSWER_SELECTED', 'FEEDBACK_CORRECT', 'FEEDBACK_WRONG', 'FEEDBACK_TIMEOUT']);
  if (!feedbackPhases.has(phase)) return 'default';

  if (position === selectedPosition) {
    return isCorrect ? 'correct-selected' : 'wrong-selected';
  }
  if (isCorrect) return 'correct-revealed';
  return 'dim';
}

export function GameArena({ engine, reducedMotion, onSelect }: GameArenaProps) {
  const effectivePhase = engine.phase === 'PAUSED' ? (engine.resumePhase ?? engine.phase) : engine.phase;
  const showAnswers =
    effectivePhase === 'ANSWERING' ||
    effectivePhase === 'ANSWER_SELECTED' ||
    effectivePhase === 'FEEDBACK_CORRECT' ||
    effectivePhase === 'FEEDBACK_WRONG' ||
    effectivePhase === 'FEEDBACK_TIMEOUT';

  return (
    <div className="game-arena">
      {CELL_AREAS.map((area, idx) => {
        const option = engine.round?.options[idx];
        return (
          <div className={`game-arena__cell game-arena__cell--${area}`} key={area}>
            <AnimatePresence>
              {showAnswers && option ? (
                <AnswerCard
                  key={`${engine.roundNumber}-${option.asset.id}`}
                  option={option}
                  interactive={effectivePhase === 'ANSWERING' && engine.phase === 'ANSWERING'}
                  reducedMotion={reducedMotion}
                  visualState={computeVisualState(idx, option.isCorrect, effectivePhase, engine.selectedPosition)}
                  onSelect={onSelect}
                />
              ) : (
                <motion.div
                  key={`placeholder-${area}`}
                  className="game-arena__placeholder"
                  initial={false}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                />
              )}
            </AnimatePresence>
          </div>
        );
      })}
      <div className="game-arena__cell game-arena__cell--center">
        <CenterStage
          phase={effectivePhase}
          round={engine.round}
          phaseStartedAt={engine.phaseStartedAt}
          phaseDuration={engine.phaseDuration}
          paused={engine.phase === 'PAUSED'}
          pendingOutcome={engine.pendingOutcome}
          reducedMotion={reducedMotion}
        />
      </div>
    </div>
  );
}
