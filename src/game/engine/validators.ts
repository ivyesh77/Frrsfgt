import type { Round } from '../../types';

/** Runtime guard ensuring a generated round is fair and internally consistent. */
export function validateRound(round: Round): string | null {
  if (!round.target || !round.target.id) return 'missing target';
  if (round.options.length !== 4) return 'round must have exactly 4 options';

  const ids = round.options.map((o) => o.asset.id);
  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== 4) return 'duplicate answer ids in round';

  const targetOccurrences = ids.filter((id) => id === round.target.id).length;
  if (targetOccurrences !== 1) return 'target must appear exactly once among options';

  const correctOptions = round.options.filter((o) => o.isCorrect);
  if (correctOptions.length !== 1) return 'exactly one option must be marked correct';
  if (correctOptions[0]?.asset.id !== round.target.id) return 'correct option must match target';

  if (round.correctPosition < 0 || round.correctPosition > 3) return 'invalid correct position';
  if (round.options[round.correctPosition]?.asset.id !== round.target.id) {
    return 'correctPosition does not point at the correct option';
  }

  for (const option of round.options) {
    if (!option.asset.src) return `asset ${option.asset.id} is missing an image source`;
  }

  if (round.memorizeMs <= 0 || round.answerMs <= 0) return 'invalid timer configuration';

  return null;
}
