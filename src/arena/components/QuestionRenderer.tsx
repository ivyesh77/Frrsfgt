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
    <div className="arena-prompt arena-prompt--image">
      {asset && <img src={asset.src} alt={asset.name} draggable={false} />}
    </div>
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
        <div className="arena-options-grid arena-options-grid--memoryMatch">
          {round.options.map((option) => {
            const isCorrectReveal = isResolved && round.resolution!.correctToken === option.token;
            const isWrongPick = isResolved && !round.resolution!.correct && round.resolution!.correctToken !== option.token;
            return (
              <button
                key={option.token}
                type="button"
                className={[
                  'arena-option',
                  isCorrectReveal ? 'arena-option--correct' : '',
                  isWrongPick ? 'arena-option--dim' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                disabled={!canAnswer}
                onClick={() => onAnswer(option.token)}
              >
                <OptionContent option={option} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
