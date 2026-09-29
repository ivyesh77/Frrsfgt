import type { GeneratedQuestion } from '../types.js';
import { newQuestionId, pickDistinct, shuffle } from './shared.js';

const EMOJI_POOL = [
  '🐶', '🐱', '🦊', '🐼', '🐸', '🐵', '🦁', '🐷', '🐔', '🐧',
  '🍕', '🍔', '🍩', '🍓', '🍉', '🥑', '🍪', '🍰', '🌮', '🍿',
  '⚽', '🏀', '🎾', '🏈', '🎱', '🚀', '⭐', '🌈', '⚡', '🔥',
];

export function generateEmojiMatch(): GeneratedQuestion {
  const [target, ...distractors] = pickDistinct(EMOJI_POOL, 4);
  if (!target) throw new Error('Not enough emoji to generate an emoji match question');

  const options = shuffle([target, ...distractors]);
  const correctIndex = options.indexOf(target);

  return {
    question: {
      id: newQuestionId(),
      kind: 'emojiMatch',
      memorizeMs: 1300,
      answerMs: 3500,
      prompt: { emoji: target },
      options: options.map((emoji) => ({ emoji })),
    },
    correctIndex,
  };
}
