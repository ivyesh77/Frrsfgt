import { PLATFORM_FEE_RATE } from './types.js';

export interface PayoutInputPlayer {
  userId: string;
  score: number;
  wrong: number;
  lastAnswerAt: number | null;
}

export interface PayoutBreakdown {
  /** Players ranked best-to-worst (score desc, then fewer wrong, then earliest last answer). */
  ranked: PayoutInputPlayer[];
  /** True when nobody scored a single point — the match is void: full refund, zero platform cut. */
  isVoidMatch: boolean;
  winnerIds: Set<string>;
  platformCut: number;
  winnerPayoutTotal: number;
  /** Equal split of winnerPayoutTotal across winnerIds (floor — any remainder from an odd split is simply never claimed, never lost from the ledger since it's not credited to anyone but also never taken as extra platform revenue). */
  perWinnerPayout: number;
}

/**
 * Pure, deterministic payout calculation — no I/O, no timers, no randomness.
 * Kept separate from the live room/match orchestration (`rooms.ts`) so it can
 * be unit-tested directly with contrived scores instead of depending on the
 * outcome of live (randomized) gameplay, which made an earlier version of
 * this test suite occasionally flaky.
 */
export function computeMatchPayout(pool: number, players: PayoutInputPlayer[]): PayoutBreakdown {
  const ranked = players.slice().sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.wrong !== b.wrong) return a.wrong - b.wrong;
    const at = a.lastAnswerAt ?? Number.MAX_SAFE_INTEGER;
    const bt = b.lastAnswerAt ?? Number.MAX_SAFE_INTEGER;
    return at - bt;
  });

  const top = ranked[0];
  const isVoidMatch = !top || top.score <= 0;
  // Winners are only ever split across multiple players if they are tied on EVERY
  // tie-break level (score, then wrong count, then last-answer timestamp) — a tie-break
  // that resolves a difference at any level produces a single winner, not a split.
  const winners =
    isVoidMatch || !top
      ? []
      : ranked.filter(
          (p) =>
            p.score === top.score &&
            p.wrong === top.wrong &&
            (p.lastAnswerAt ?? Number.MAX_SAFE_INTEGER) === (top.lastAnswerAt ?? Number.MAX_SAFE_INTEGER),
        );

  const platformCut = isVoidMatch ? 0 : Math.round(pool * PLATFORM_FEE_RATE);
  const winnerPayoutTotal = pool - platformCut;
  const perWinnerPayout = winners.length > 0 ? Math.floor(winnerPayoutTotal / winners.length) : 0;

  return {
    ranked,
    isVoidMatch,
    winnerIds: new Set(winners.map((w) => w.userId)),
    platformCut,
    winnerPayoutTotal,
    perWinnerPayout,
  };
}
