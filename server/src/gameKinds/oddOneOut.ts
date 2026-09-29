import type { GeneratedQuestion } from '../types.js';
import { newQuestionId, pickDistinct, randomInt } from './shared.js';

const EMOJI_POOL = [
  '🐶', '🐱', '🦊', '🐼', '🐸', '🐵', '🦁', '🐷', '🐔', '🐧',
  '🍕', '🍔', '🍩', '🍓', '🍉', '🥑', '🍪', '🍰', '🌮', '🍿',
];

/** Three tiles share one emoji, one tile is the odd one out — find it. */
export function generateOddOneOut(): GeneratedQuestion {
  const [common, odd] = pickDistinct(EMOJI_POOL, 2);
  if (!common || !odd) throw new Error('Not enough emoji to generate an odd-one-out question');

  const oddIndex = randomInt(0, 3);
  const options = Array.from({ length: 4 }, (_, i) => ({ emoji: i === oddIndex ? odd : common }));

  return {
    question: {
      id: newQuestionId(),
      kind: 'oddOneOut',
      memorizeMs: 0,
      answerMs: 4000,
      prompt: null,
      options,
    },
    correctIndex: oddIndex,
  };
}
