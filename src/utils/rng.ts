/** Lightweight randomization helpers shared by the round generator. */

/** Fisher-Yates shuffle. Never mutates the input array. */
export function shuffle<T>(items: readonly T[]): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = result[i];
    const b = result[j];
    if (a === undefined || b === undefined) continue; // unreachable for i,j < length
    result[i] = b;
    result[j] = a;
  }
  return result;
}

export function pickRandom<T>(items: readonly T[]): T {
  if (items.length === 0) throw new Error('pickRandom called with an empty array');
  const index = Math.floor(Math.random() * items.length);
  return items[index] as T;
}
