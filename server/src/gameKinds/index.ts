import type { GameKind, GeneratedRound } from '../types.js';
import { generateMemoryMatch } from './memoryMatch.js';

type Generator = () => GeneratedRound;

export const GAME_KIND_GENERATORS: Record<GameKind, Generator> = {
  memoryMatch: generateMemoryMatch,
};

export function generateRound(kind: GameKind): GeneratedRound {
  const generator = GAME_KIND_GENERATORS[kind];
  return generator();
}

export const GAME_KIND_LABELS: Record<GameKind, string> = {
  memoryMatch: 'Memory Match',
};
