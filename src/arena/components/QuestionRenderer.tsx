import { getAssetById } from '../../data/imageRegistry';
import type { ArcadeQuestionPublic, MemoryMatchPayload } from '../types';
import type { AnswerFeedback } from '../useArena';

export type QuestionPhase = 'memorize' | 'answer' | 'expired';

interface QuestionRendererProps {
  question: ArcadeQuestionPublic;
  phase: QuestionPhase;
  answerFeedback: AnswerFeedback | null;
  chancesLeft: number;
  onAnswer: (index: number) => void;
}

function PromptPanel({ question }: { question: ArcadeQuestionPublic }) {
  if (question.prompt === null || question.prompt === undefined) return null;
  const asset = getAssetById((question.prompt as MemoryMatchPayload).assetId);
  return (
    <div className="arena-prompt arena-prompt--image">
      {asset && <img src={asset.src} alt={asset.name} draggable={false} />}
    </div>
  );
}

function OptionContent({ option }: { option: unknown }) {
  const asset = getAssetById((option as MemoryMatchPayload).assetId);
  return asset ? <img src={asset.src} alt={asset.name} draggable={false} /> : null;
}

export function QuestionRenderer({ question, phase, answerFeedback, chancesLeft, onAnswer }: QuestionRendererProps) {
  const canAnswer = phase === 'answer' && chancesLeft > 0 && !answerFeedback;
  const showPrompt = question.prompt !== null && (question.memorizeMs === 0 || phase === 'memorize');

  return (
    <div className="arena-question">
      {phase === 'memorize' && question.memorizeMs > 0 && (
        <div className="arena-question__hint">Memorize…</div>
      )}
      {showPrompt && <PromptPanel question={question} />}

      {phase !== 'memorize' && (
        <div className="arena-options-grid arena-options-grid--memoryMatch">
          {question.options.map((option, index) => {
            const isCorrectReveal = answerFeedback && answerFeedback.correctIndex === index;
            const isWrongPick =
              answerFeedback && !answerFeedback.correct && answerFeedback.correctIndex !== index;
            return (
              <button
                key={index}
                type="button"
                className={[
                  'arena-option',
                  isCorrectReveal ? 'arena-option--correct' : '',
                  isWrongPick ? 'arena-option--dim' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                disabled={!canAnswer}
                onClick={() => onAnswer(index)}
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
