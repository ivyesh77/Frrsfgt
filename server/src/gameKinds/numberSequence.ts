import type { GeneratedQuestion } from '../types.js';
import { newQuestionId, randomInt, shuffle } from './shared.js';

export function generateNumberSequence(): GeneratedQuestion {
  const start = randomInt(1, 15);
  const step = randomInt(2, 6) * (Math.random() < 0.15 ? -1 : 1);
  const sequence = [start, start + step, start + step * 2];
  const answer = start + step * 3;

  const distractorPool = new Set<number>();
  while (distractorPool.size < 3) {
    const offset = randomInt(-step * 2 || -4, step * 2 || 4) || 1;
    const candidate = answer + offset;
    if (candidate !== answer) distractorPool.add(candidate);
  }

  const options = shuffle([answer, ...distractorPool]);
  const correctIndex = options.indexOf(answer);

  return {
    question: {
      id: newQuestionId(),
      kind: 'numberSequence',
      memorizeMs: 0,
      answerMs: 5000,
      prompt: { sequence },
      options: options.map((value) => ({ value })),
    },
    correctIndex,
  };
}
