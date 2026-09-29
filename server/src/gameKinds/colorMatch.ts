import type { GeneratedQuestion } from '../types.js';
import { newQuestionId, pickDistinct, shuffle } from './shared.js';

const PALETTE = [
  '#ff5c78', '#ff9e4a', '#ffe08a', '#3fe08a', '#35e6c8', '#4c8bd6', '#8b6bff', '#e06bd6',
  '#ff8fa3', '#f2b134', '#7fd1e8', '#9be15d', '#c9a6ff', '#ff6b8b', '#5cb14f', '#e8483f',
];

export function generateColorMatch(): GeneratedQuestion {
  const [target, ...distractors] = pickDistinct(PALETTE, 4);
  if (!target) throw new Error('Not enough colors to generate a color match question');

  const options = shuffle([target, ...distractors]);
  const correctIndex = options.indexOf(target);

  return {
    question: {
      id: newQuestionId(),
      kind: 'colorMatch',
      memorizeMs: 1300,
      answerMs: 3500,
      prompt: { color: target },
      options: options.map((color) => ({ color })),
    },
    correctIndex,
  };
}
