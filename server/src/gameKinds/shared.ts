import { nanoid } from 'nanoid';

export function shuffle<T>(items: readonly T[]): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = result[i];
    const b = result[j];
    if (a === undefined || b === undefined) continue;
    result[i] = b;
    result[j] = a;
  }
  return result;
}

export function pick<T>(items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick() called with empty array');
  return items[Math.floor(Math.random() * items.length)] as T;
}

export function pickDistinct<T>(items: readonly T[], count: number, exclude: readonly T[] = []): T[] {
  const pool = shuffle(items.filter((i) => !exclude.includes(i)));
  return pool.slice(0, count);
}

export function newQuestionId(): string {
  return nanoid(10);
}

/** A freshly-random, per-round opaque token — used both for round ids and for each
 *  option's answer token. Callers must never derive meaning from its value; it is only
 *  ever compared for exact equality against the server's own stored state. */
export function newRoundToken(): string {
  return nanoid(16);
}

export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
