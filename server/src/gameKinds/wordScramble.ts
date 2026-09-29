import type { GeneratedQuestion } from '../types.js';
import { newQuestionId, pickDistinct, shuffle } from './shared.js';

const WORDS = [
  'CAT', 'DOG', 'FOX', 'SUN', 'MOON', 'STAR', 'TREE', 'FISH', 'BIRD', 'LION',
  'CAKE', 'BALL', 'BOOK', 'RAIN', 'SNOW', 'GOLD', 'RING', 'SHIP', 'KITE', 'ROSE',
];

function scramble(word: string): string {
  const letters = word.split('');
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const shuffled = shuffle(letters).join('');
    if (shuffled !== word) return shuffled;
  }
  return letters.reverse().join('');
}

export function generateWordScramble(): GeneratedQuestion {
  const [target, ...distractors] = pickDistinct(WORDS, 4);
  if (!target) throw new Error('Not enough words to generate a scramble question');

  const options = shuffle([target, ...distractors]);
  const correctIndex = options.indexOf(target);

  return {
    question: {
      id: newQuestionId(),
      kind: 'wordScramble',
      memorizeMs: 0,
      answerMs: 5500,
      prompt: { scrambled: scramble(target) },
      options: options.map((word) => ({ word })),
    },
    correctIndex,
  };
}
