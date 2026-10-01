/**
 * Player-facing match history — built entirely from the same real, append-only
 * match-history ledger the admin Rooms/Analytics screens read (see admin/matchHistory.ts),
 * never a second/fabricated data source. The only thing this module adds on top is
 * per-viewer redaction: every OTHER participant's real userId is replaced with an opaque,
 * per-read-only placeholder before anything leaves this module, so a player's own match
 * history can never be used to learn another account's real id (the same rule the live
 * room/match:end payloads already enforce — see rooms.ts toPlayerPublic).
 */
import { matchHistoryForUser } from './admin/matchHistory.js';
import type { MatchHistoryEntry } from './admin/types.js';
import { roomFormatMeta, type RoomFormat } from './types.js';

export type PublicMatchOutcome = 'win' | 'loss' | 'draw' | 'void';

export interface PublicMatchOpponent {
  name: string;
  score: number;
  isWinner: boolean;
}

export interface PublicMatchHistoryItem {
  roomId: string;
  format: RoomFormat;
  formatLabel: string;
  entryFee: number;
  status: 'finished' | 'cancelled';
  outcome: PublicMatchOutcome;
  yourScore: number | null;
  yourCorrect: number | null;
  yourWrong: number | null;
  yourMaxStreak: number | null;
  yourPayout: number | null;
  placement: number | null;
  playerCount: number;
  opponents: PublicMatchOpponent[];
  startedAt: number | null;
  endedAt: number;
  durationMs: number | null;
}

function outcomeFor(entry: MatchHistoryEntry, userId: string): PublicMatchOutcome {
  if (entry.status === 'cancelled' || entry.isVoidMatch) return 'void';
  if (entry.isDraw) return 'draw';
  return entry.winnerIds.includes(userId) ? 'win' : 'loss';
}

function toPublicItem(entry: MatchHistoryEntry, userId: string): PublicMatchHistoryItem {
  const mine = entry.results.find((r) => r.userId === userId) ?? null;
  const others = entry.results.filter((r) => r.userId !== userId);
  const ranked = entry.results.slice().sort((a, b) => b.score - a.score);
  const placement = mine ? ranked.findIndex((r) => r.userId === userId) + 1 || null : null;

  return {
    roomId: entry.roomId,
    format: entry.format as RoomFormat,
    formatLabel: roomFormatMeta(entry.format as RoomFormat).label,
    entryFee: entry.entryFee,
    status: entry.status,
    outcome: outcomeFor(entry, userId),
    yourScore: mine?.score ?? null,
    yourCorrect: mine?.correct ?? null,
    yourWrong: mine?.wrong ?? null,
    yourMaxStreak: mine?.maxStreak ?? null,
    yourPayout: mine?.payout ?? null,
    placement,
    playerCount: entry.playerCount,
    opponents: others.map((o) => ({ name: o.name, score: o.score, isWinner: o.isWinner })),
    startedAt: entry.startedAt,
    endedAt: entry.endedAt,
    durationMs: entry.startedAt !== null ? entry.endedAt - entry.startedAt : null,
  };
}

export interface MatchHistoryQuery {
  page?: number;
  pageSize?: number;
  format?: RoomFormat | 'all';
  outcome?: PublicMatchOutcome | 'all';
}

export interface PaginatedMatchHistory {
  items: PublicMatchHistoryItem[];
  total: number;
  page: number;
  pageSize: number;
}

/** Server-side filtered + paginated — a client only ever receives the one page it asked
 *  for, never the full ledger to filter/paginate itself. */
export function getPlayerMatchHistory(userId: string, query: MatchHistoryQuery = {}): PaginatedMatchHistory {
  const all = matchHistoryForUser(userId).map((entry) => toPublicItem(entry, userId));
  const formatFiltered = query.format && query.format !== 'all' ? all.filter((m) => m.format === query.format) : all;
  const outcomeFiltered = query.outcome && query.outcome !== 'all' ? formatFiltered.filter((m) => m.outcome === query.outcome) : formatFiltered;

  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, query.pageSize ?? 10));
  const start = (page - 1) * pageSize;
  return { items: outcomeFiltered.slice(start, start + pageSize), total: outcomeFiltered.length, page, pageSize };
}

/** Full detail for exactly one match this user actually participated in — 403-equivalent
 *  (returns null, mapped to 404 by the route) for any match id they weren't seated in, so
 *  a guessed/enumerated roomId can never leak another account's match detail. */
export function getPlayerMatchDetail(userId: string, roomId: string): PublicMatchHistoryItem | null {
  const entry = matchHistoryForUser(userId).find((m) => m.roomId === roomId);
  if (!entry) return null;
  return toPublicItem(entry, userId);
}
