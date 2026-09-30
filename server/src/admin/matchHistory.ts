/** Lightweight, append-only record of every finished/cancelled match — written by
 *  rooms.ts the instant a match concludes, because the live Room object itself is deleted
 *  from memory shortly afterward (see rooms.ts). This is what backs admin room history,
 *  per-user match history, and match-volume analytics without inventing any fake data:
 *  every entry here corresponds 1:1 to a real match that was actually played. */
import { appendMatchHistory, listMatchHistory } from './store.js';
import type { MatchHistoryEntry } from './types.js';

export function recordMatch(entry: MatchHistoryEntry): void {
  appendMatchHistory(entry);
}

export function allMatchHistory(): MatchHistoryEntry[] {
  return listMatchHistory();
}

export function matchHistoryForUser(userId: string): MatchHistoryEntry[] {
  return listMatchHistory()
    .filter((m) => m.playerIds.includes(userId))
    .slice()
    .reverse();
}
