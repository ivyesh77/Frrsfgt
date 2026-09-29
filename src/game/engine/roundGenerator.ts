import type { AnswerOption, AssetMetadata, Round } from '../../types';
import { pickRandom, shuffle } from '../../utils/rng';
import { getDifficultyForRound } from './difficulty';
import { validateRound } from './validators';
import { HISTORY_WINDOW } from './constants';

function pickTarget(allAssets: AssetMetadata[], recentIds: string[]): AssetMetadata {
  const eligible = allAssets.filter((a) => !recentIds.includes(a.id));
  const pool = eligible.length > 0 ? eligible : allAssets;
  return pickRandom(pool);
}

/**
 * Picks 3 distinct distractors. `similarity` biases selection toward the
 * target's own category (harder to tell apart) while always falling back to
 * whatever assets are available so generation never fails on a small deck.
 */
function pickDistractors(allAssets: AssetMetadata[], target: AssetMetadata, similarity: number): AssetMetadata[] {
  const rest = allAssets.filter((a) => a.id !== target.id);
  const sameCategory = shuffle(rest.filter((a) => a.category === target.category));
  const otherCategory = shuffle(rest.filter((a) => a.category !== target.category));

  const chosen: AssetMetadata[] = [];
  const isChosen = (a: AssetMetadata) => chosen.some((c) => c.id === a.id);

  for (let i = 0; i < 3; i += 1) {
    const preferSame = Math.random() < similarity;
    const primary = preferSame ? sameCategory : otherCategory;
    const secondary = preferSame ? otherCategory : sameCategory;

    const fromPrimary = primary.find((a) => !isChosen(a));
    const fromSecondary = secondary.find((a) => !isChosen(a));
    const pick = fromPrimary ?? fromSecondary;

    if (!pick) {
      // Deck is smaller than 4 unique assets — should not happen in production
      // with a real registry, but fail loudly rather than silently duplicating.
      throw new Error('Not enough unique assets to build a round');
    }
    chosen.push(pick);
  }

  return chosen;
}

function buildRound(roundNumber: number, allAssets: AssetMetadata[], recentIds: string[]): Round {
  const difficulty = getDifficultyForRound(roundNumber);
  const target = pickTarget(allAssets, recentIds);
  const distractors = pickDistractors(allAssets, target, difficulty.similarity);

  const unshuffled: Omit<AnswerOption, 'position'>[] = [
    { asset: target, isCorrect: true },
    ...distractors.map((asset) => ({ asset, isCorrect: false })),
  ];

  const shuffled = shuffle(unshuffled);
  const options: AnswerOption[] = shuffled.map((option, position) => ({ ...option, position }));
  const correctPosition = options.findIndex((o) => o.isCorrect);

  return {
    index: roundNumber,
    tier: difficulty.tier,
    target,
    options,
    correctPosition,
    memorizeMs: difficulty.memorizeMs,
    answerMs: difficulty.answerMs,
    scoreMultiplier: difficulty.scoreMultiplier,
  };
}

/**
 * Generates a single validated round. Retries a few times on validation
 * failure (defensive only — a correct generator should never actually need
 * more than one attempt) before throwing so bugs surface loudly in dev.
 */
export function generateRound(roundNumber: number, allAssets: AssetMetadata[], recentTargetIds: string[]): Round {
  const attempts = 5;
  let lastError: string | null = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const round = buildRound(roundNumber, allAssets, recentTargetIds);
    const error = validateRound(round);
    if (!error) return round;
    lastError = error;
  }

  throw new Error(`Failed to generate a valid round: ${lastError}`);
}

export function pushHistory(history: string[], targetId: string): string[] {
  const next = [...history, targetId];
  return next.slice(Math.max(0, next.length - HISTORY_WINDOW));
}
