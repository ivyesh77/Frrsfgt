import { AnimatePresence, motion } from 'framer-motion';
import { getAssetById } from '../../data/imageRegistry';
import type { MemoryMatchPayload, RoundOptionPublic } from '../types';
import type { ActiveRoundView } from '../useArena';

interface QuestionRendererProps {
  round: ActiveRoundView;
  /** A live `Date.now()` sample from the parent's ticking clock — used only to decide
   *  when the "too fast to be human" answer window has passed and to drive the countdown
   *  visuals. The server holds and enforces the real deadlines; this is display-only. */
  now: number;
  onAnswer: (optionToken: string) => void;
}

function PromptPanel({ prompt }: { prompt: unknown }) {
  if (prompt === null || prompt === undefined) return null;
  const asset = getAssetById((prompt as MemoryMatchPayload).assetId);
  return (
    <motion.div
      className="arena-prompt arena-prompt--image"
      initial={{ scale: 0.7, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
    >
      {asset && <img src={asset.src} alt={asset.name} draggable={false} />}
    </motion.div>
  );
}

function OptionContent({ option }: { option: RoundOptionPublic }) {
  const asset = getAssetById(option.assetId);
  return asset ? <img src={asset.src} alt={asset.name} draggable={false} /> : null;
}

export function QuestionRenderer({ round, now, onAnswer }: QuestionRendererProps) {
  const isMemorizing = round.options === null;
  const isResolved = round.resolution !== null;
  // The server is the sole authority on timing — this only prevents the client from ever
  // firing a request it already knows would be rejected as "too fast" (see rooms.ts
  // MIN_REACTION_MS); it changes nothing about what the server actually enforces.
  const withinReactionWindow = round.minAnswerAt !== null && now < round.minAnswerAt;
  const canAnswer = !isMemorizing && !isResolved && !withinReactionWindow;

  return (
    <div className="arena-question">
      {isMemorizing && <div className="arena-question__hint">Memorize…</div>}
      {isMemorizing && <PromptPanel prompt={round.prompt} />}

      {!isMemorizing && round.options && (
        <motion.div
          key={round.roundId}
          className="arena-options-grid arena-options-grid--memoryMatch"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.15 }}
        >
          {round.options.map((option) => {
            const isCorrectReveal = isResolved && round.resolution!.correctToken === option.token;
            const isMyWrongPick = isResolved && round.resolution!.pickedToken === option.token && !round.resolution!.correct;
            const isWrongDim = isResolved && !round.resolution!.correct && round.resolution!.correctToken !== option.token;
            return (
              <motion.button
                key={option.token}
                type="button"
                className={[
                  'arena-option',
                  isCorrectReveal ? 'arena-option--correct' : '',
                  isMyWrongPick ? 'arena-option--wrong' : '',
                  isWrongDim && !isMyWrongPick ? 'arena-option--dim' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                disabled={!canAnswer}
                onClick={() => onAnswer(option.token)}
                animate={isMyWrongPick ? { x: [0, -8, 8, -6, 6, 0] } : {}}
                transition={{ duration: 0.35 }}
              >
                <OptionContent option={option} />
              </motion.button>
            );
          })}
        </motion.div>
      )}

      <AnimatePresence>
        {isResolved && (
          <motion.div
            key="feedback"
            className={`arena-answer-feedback ${round.resolution!.correct ? 'arena-answer-feedback--correct' : 'arena-answer-feedback--wrong'}`}
            initial={{ opacity: 0, y: 10, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            {round.resolution!.correct ? '+1 ✓' : '−1 ✕'}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
