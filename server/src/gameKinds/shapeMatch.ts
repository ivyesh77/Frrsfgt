import type { GeneratedQuestion } from '../types.js';
import { newQuestionId, pickDistinct, shuffle } from './shared.js';

const SHAPES = ['circle', 'square', 'triangle', 'star', 'hexagon', 'diamond'] as const;

export function generateShapeMatch(): GeneratedQuestion {
  const [target, ...distractors] = pickDistinct(SHAPES, 4);
  if (!target) throw new Error('Not enough shapes to generate a shape match question');

  const options = shuffle([target, ...distractors]);
  const correctIndex = options.indexOf(target);

  return {
    question: {
      id: newQuestionId(),
      kind: 'shapeMatch',
      memorizeMs: 1300,
      answerMs: 3500,
      prompt: { shape: target },
      options: options.map((shape) => ({ shape })),
    },
    correctIndex,
  };
}
