import type { GeneratedQuestion } from '../types.js';
import { newQuestionId, randomInt, shuffle } from './shared.js';

export function generateQuickMath(): GeneratedQuestion {
  const operators = ['+', '-', '×'] as const;
  const operator = operators[randomInt(0, operators.length - 1)] as (typeof operators)[number];

  let a = randomInt(2, 20);
  let b = randomInt(2, 20);
  if (operator === '-' && b > a) [a, b] = [b, a]; // keep subtraction non-negative
  if (operator === '×') {
    a = randomInt(2, 12);
    b = randomInt(2, 12);
  }

  const answer = operator === '+' ? a + b : operator === '-' ? a - b : a * b;

  const distractorPool = new Set<number>();
  while (distractorPool.size < 3) {
    const offset = randomInt(-6, 6) || 1;
    const candidate = answer + offset;
    if (candidate !== answer && candidate >= 0) distractorPool.add(candidate);
  }

  const options = shuffle([answer, ...distractorPool]);
  const correctIndex = options.indexOf(answer);

  return {
    question: {
      id: newQuestionId(),
      kind: 'quickMath',
      memorizeMs: 0,
      answerMs: 4500,
      prompt: { expression: `${a} ${operator} ${b}` },
      options: options.map((value) => ({ value })),
    },
    correctIndex,
  };
}
