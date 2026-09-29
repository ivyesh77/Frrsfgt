import { getAssetById } from '../../data/imageRegistry';
import type {
  ArcadeQuestionPublic,
  ColorPayload,
  EmojiPayload,
  MemoryMatchPayload,
  NumberSequencePrompt,
  QuickMathPrompt,
  SequencePayload,
  ShapePayload,
  WordOption,
  WordScramblePrompt,
} from '../types';
import type { AnswerFeedback, ReactionReveal } from '../useArena';

export type QuestionPhase = 'memorize' | 'answer' | 'expired';

interface QuestionRendererProps {
  question: ArcadeQuestionPublic;
  phase: QuestionPhase;
  reactionReveal: ReactionReveal | null;
  answerFeedback: AnswerFeedback | null;
  chancesLeft: number;
  onAnswer: (index: number) => void;
}

function PromptPanel({ question }: { question: ArcadeQuestionPublic }) {
  const { kind, prompt } = question;
  if (prompt === null || prompt === undefined) return null;

  switch (kind) {
    case 'memoryMatch': {
      const asset = getAssetById((prompt as MemoryMatchPayload).assetId);
      return (
        <div className="arena-prompt arena-prompt--image">
          {asset && <img src={asset.src} alt={asset.name} draggable={false} />}
        </div>
      );
    }
    case 'colorMatch':
      return <div className="arena-prompt arena-prompt--swatch" style={{ background: (prompt as ColorPayload).color }} />;
    case 'emojiMatch':
      return <div className="arena-prompt arena-prompt--emoji">{(prompt as EmojiPayload).emoji}</div>;
    case 'shapeMatch':
      return (
        <div className="arena-prompt arena-prompt--shape-wrap">
          <span className={`arena-shape arena-shape--${(prompt as ShapePayload).shape} arena-shape--lg`} />
        </div>
      );
    case 'patternRecall':
      return (
        <div className="arena-prompt arena-prompt--sequence">
          {(prompt as SequencePayload).sequence.map((symbol, i) => (
            <span key={i}>{symbol}</span>
          ))}
        </div>
      );
    case 'quickMath':
      return <div className="arena-prompt arena-prompt--text">{(prompt as QuickMathPrompt).expression} = ?</div>;
    case 'numberSequence':
      return (
        <div className="arena-prompt arena-prompt--text">
          {(prompt as NumberSequencePrompt).sequence.join(', ')}, ?
        </div>
      );
    case 'wordScramble':
      return <div className="arena-prompt arena-prompt--letters">{(prompt as WordScramblePrompt).scrambled}</div>;
    default:
      return null;
  }
}

function OptionContent({ kind, option }: { kind: ArcadeQuestionPublic['kind']; option: unknown }) {
  switch (kind) {
    case 'memoryMatch': {
      const asset = getAssetById((option as MemoryMatchPayload).assetId);
      return asset ? <img src={asset.src} alt={asset.name} draggable={false} /> : null;
    }
    case 'colorMatch':
      return <span className="arena-option-swatch" style={{ background: (option as ColorPayload).color }} />;
    case 'emojiMatch':
    case 'oddOneOut':
      return <span className="arena-option-emoji">{(option as EmojiPayload).emoji}</span>;
    case 'shapeMatch':
      return <span className={`arena-shape arena-shape--${(option as ShapePayload).shape}`} />;
    case 'patternRecall':
      return (
        <span className="arena-option-sequence">
          {(option as SequencePayload).sequence.map((symbol, i) => (
            <span key={i}>{symbol}</span>
          ))}
        </span>
      );
    case 'quickMath':
    case 'numberSequence':
      return <span className="arena-option-number">{(option as { value: number }).value}</span>;
    case 'wordScramble':
      return <span className="arena-option-word">{(option as WordOption).word}</span>;
    case 'reactionTap':
    default:
      return null;
  }
}

export function QuestionRenderer({
  question,
  phase,
  reactionReveal,
  answerFeedback,
  chancesLeft,
  onAnswer,
}: QuestionRendererProps) {
  const canAnswer = phase === 'answer' && chancesLeft > 0 && !answerFeedback;
  const showPrompt = question.prompt !== null && (question.memorizeMs === 0 || phase === 'memorize');

  return (
    <div className="arena-question">
      {phase === 'memorize' && question.memorizeMs > 0 && (
        <div className="arena-question__hint">Memorize…</div>
      )}
      {showPrompt && <PromptPanel question={question} />}

      {phase !== 'memorize' && (
        <div className={`arena-options-grid arena-options-grid--${question.kind}`}>
          {question.options.map((option, index) => {
            const isHot = question.kind === 'reactionTap' && reactionReveal?.index === index;
            const isCorrectReveal = answerFeedback && answerFeedback.correctIndex === index;
            const isWrongPick =
              answerFeedback && !answerFeedback.correct && answerFeedback.correctIndex !== index;
            return (
              <button
                key={index}
                type="button"
                className={[
                  'arena-option',
                  isHot ? 'arena-option--hot' : '',
                  isCorrectReveal ? 'arena-option--correct' : '',
                  isWrongPick ? 'arena-option--dim' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                disabled={!canAnswer}
                onClick={() => onAnswer(index)}
              >
                <OptionContent kind={question.kind} option={option} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
