import type { GameKind, GeneratedQuestion } from '../types.js';
import { generateColorMatch } from './colorMatch.js';
import { generateEmojiMatch } from './emojiMatch.js';
import { generateMemoryMatch } from './memoryMatch.js';
import { generateNumberSequence } from './numberSequence.js';
import { generateOddOneOut } from './oddOneOut.js';
import { generatePatternRecall } from './patternRecall.js';
import { generateQuickMath } from './quickMath.js';
import { generateReactionTap } from './reactionTap.js';
import { generateShapeMatch } from './shapeMatch.js';
import { generateWordScramble } from './wordScramble.js';

type Generator = () => GeneratedQuestion;

export const GAME_KIND_GENERATORS: Record<GameKind, Generator> = {
  memoryMatch: generateMemoryMatch,
  quickMath: generateQuickMath,
  colorMatch: generateColorMatch,
  emojiMatch: generateEmojiMatch,
  oddOneOut: generateOddOneOut,
  numberSequence: generateNumberSequence,
  wordScramble: generateWordScramble,
  shapeMatch: generateShapeMatch,
  patternRecall: generatePatternRecall,
  reactionTap: generateReactionTap,
};

export function generateQuestion(kind: GameKind): GeneratedQuestion {
  const generator = GAME_KIND_GENERATORS[kind];
  return generator();
}

export const GAME_KIND_LABELS: Record<GameKind, string> = {
  memoryMatch: 'Memory Match',
  quickMath: 'Quick Math',
  colorMatch: 'Color Match',
  emojiMatch: 'Emoji Match',
  oddOneOut: 'Odd One Out',
  numberSequence: 'Number Sequence',
  wordScramble: 'Word Scramble',
  shapeMatch: 'Shape Match',
  patternRecall: 'Pattern Recall',
  reactionTap: 'Reaction Tap',
};
