import type { GameKind, GeneratedQuestion } from '../types.js';
import { generateMemoryMatch } from './memoryMatch.js';

type Generator = () => GeneratedQuestion;

export const GAME_KIND_GENERATORS: Record<GameKind, Generator> = {
  memoryMatch: generateMemoryMatch,
};

export function generateQuestion(kind: GameKind): GeneratedQuestion {
  const generator = GAME_KIND_GENERATORS[kind];
  return generator();
}

export const GAME_KIND_LABELS: Record<GameKind, string> = {
  memoryMatch: 'Memory Match',
};
