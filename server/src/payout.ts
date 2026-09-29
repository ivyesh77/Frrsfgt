import { FIRST_PLACE_SHARE, PLATFORM_FEE_RATE } from './types.js';

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
  /** Exact payout per winner, keyed by userId. With two winners, 1st place gets
   *  FIRST_PLACE_SHARE of the winner pool and 2nd place gets the exact remainder
   *  (so the full winnerPayoutTotal is always allocated, never rounded away). If
   *  only one player actually scored, that sole scorer takes the entire pool alone. */
  payoutByUserId: Map<string, number>;
}

/**
 * Pure, deterministic payout calculation — no I/O, no timers, no randomness.
 * Kept separate from the live room/match orchestration (`rooms.ts`) so it can
 * be unit-tested directly with contrived scores instead of depending on the
 * outcome of live (randomized) gameplay, which made an earlier version of
 * this test suite occasionally flaky.
 *
 * `winnerCount` controls how many top scorers get paid: 1 for a 1v1 duel
 * (winner takes the entire winner pool, loser gets nothing) or 2 for a
 * 4-player squad match (top 2 scorers split the winner pool 60/40, best to
 * worst; the bottom 2 win nothing and are not refunded — their entry fee is
 * already part of the pool the winners split). Defaults to 2 (squad) to
 * match every existing caller. A player who never scores a single point is
 * never eligible to win, even if their rank would otherwise place them among
 * the paid positions.
 */
export function computeMatchPayout(pool: number, players: PayoutInputPlayer[], winnerCount = 2): PayoutBreakdown {
  const ranked = players.slice().sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.wrong !== b.wrong) return a.wrong - b.wrong;
    const at = a.lastAnswerAt ?? Number.MAX_SAFE_INTEGER;
    const bt = b.lastAnswerAt ?? Number.MAX_SAFE_INTEGER;
    return at - bt;
  });

  const scorers = ranked.filter((p) => p.score > 0);
  const isVoidMatch = scorers.length === 0;

  const platformCut = isVoidMatch ? 0 : Math.round(pool * PLATFORM_FEE_RATE);
  const winnerPayoutTotal = pool - platformCut;

  // Top `winnerCount` among players who actually scored take the pool. If only
  // one player scored (or winnerCount is 1, as in a duel), they take all of it —
  // a 0-score player never gets paid.
  const winners = isVoidMatch ? [] : scorers.slice(0, winnerCount);
  const payoutByUserId = new Map<string, number>();
  const [first, second] = winners;
  if (first && !second) {
    payoutByUserId.set(first.userId, winnerPayoutTotal);
  } else if (first && second) {
    const firstPlacePayout = Math.round(winnerPayoutTotal * FIRST_PLACE_SHARE);
    payoutByUserId.set(first.userId, firstPlacePayout);
    payoutByUserId.set(second.userId, winnerPayoutTotal - firstPlacePayout);
  }

  return {
    ranked,
    isVoidMatch,
    winnerIds: new Set(winners.map((w) => w.userId)),
    platformCut,
    winnerPayoutTotal,
    payoutByUserId,
  };
}
