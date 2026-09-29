import type { GeneratedQuestion } from '../types.js';
import { newQuestionId, pickDistinct, randomInt, shuffle } from './shared.js';

const SYMBOLS = ['🔺', '🔵', '🟩', '⭐', '🟣', '🔶'];

function randomSequence(length: number): string[] {
  return Array.from({ length }, () => SYMBOLS[randomInt(0, SYMBOLS.length - 1)] as string);
}

function mutate(sequence: string[]): string[] {
  const copy = sequence.slice();
  const index = randomInt(0, copy.length - 1);
  const replacement = pickDistinct(
    SYMBOLS.filter((s) => s !== copy[index]),
    1,
  )[0] as string;
  copy[index] = replacement;
  return copy;
}

export function generatePatternRecall(): GeneratedQuestion {
  const target = randomSequence(3);

  const distractors: string[][] = [];
  while (distractors.length < 3) {
    const candidate = mutate(target);
    const key = candidate.join('');
    if (key !== target.join('') && !distractors.some((d) => d.join('') === key)) {
      distractors.push(candidate);
    }
  }

  const options = shuffle([target, ...distractors]);
  const correctIndex = options.findIndex((o) => o.join('') === target.join(''));

  return {
    question: {
      id: newQuestionId(),
      kind: 'patternRecall',
      memorizeMs: 1600,
      answerMs: 4500,
      prompt: { sequence: target },
      options: options.map((sequence) => ({ sequence })),
    },
    correctIndex,
  };
}
