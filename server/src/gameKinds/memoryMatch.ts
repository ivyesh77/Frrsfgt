import type { GeneratedQuestion } from '../types.js';
import { ASSET_MIRROR } from './assetMirror.js';
import { newQuestionId, pickDistinct, shuffle } from './shared.js';

export function generateMemoryMatch(): GeneratedQuestion {
  const [target, ...distractors] = pickDistinct(ASSET_MIRROR, 4);
  if (!target) throw new Error('Not enough assets to generate a memory match question');

  const shuffledOptions = shuffle([target, ...distractors]);
  const correctIndex = shuffledOptions.findIndex((o) => o.id === target.id);

  return {
    question: {
      id: newQuestionId(),
      kind: 'memoryMatch',
      memorizeMs: 1800,
      answerMs: 4200,
      prompt: { assetId: target.id },
      options: shuffledOptions.map((o) => ({ assetId: o.id })),
    },
    correctIndex,
  };
}
