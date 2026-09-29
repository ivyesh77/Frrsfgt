import type { GeneratedQuestion } from '../types.js';
import { newQuestionId, randomInt } from './shared.js';

/**
 * Four blank tiles; after a random delay ONE lights up (revealed separately
 * via a `match:reveal` event so the winning tile is never present in the
 * initial payload — this is the one game kind where the option itself would
 * otherwise leak the answer ahead of time).
 */
export function generateReactionTap(): GeneratedQuestion {
  const correctIndex = randomInt(0, 3);
  const memorizeMs = randomInt(700, 2400); // unpredictable wait, like a false-start guard

  return {
    question: {
      id: newQuestionId(),
      kind: 'reactionTap',
      memorizeMs,
      answerMs: 2000,
      prompt: null,
      options: [{}, {}, {}, {}],
    },
    correctIndex,
  };
}
