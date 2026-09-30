import { FIRST_PLACE_SHARE, PLATFORM_FEE_RATE } from './types.js';

export interface PayoutInputPlayer {
  userId: string;
  score: number;
  correct: number;
  wrong: number;
  lastAnswerAt: number | null;
  /** True if this player forfeited (disconnected past the reconnect grace window) before
   *  the match timer elapsed. A forfeiting player can never be ranked above a player who
   *  stayed connected, regardless of the score they had banked before dropping. */
  forfeited: boolean;
}

export interface PayoutBreakdown {
  /** Players ranked best-to-worst: connected players before forfeited players, then score
   *  desc, then fewer wrong, then earliest last answer. */
  ranked: PayoutInputPlayer[];
  /** True only when literally nobody ever submitted a single answer (correct+wrong===0 for
   *  every player) — e.g. every occupant disconnected immediately. Full refund, zero cut.
   *  Note this is intentionally NOT "nobody scored above zero" — under +1/-1 scoring with no
   *  elimination, a player who genuinely played can legitimately end at 0 or negative, and
   *  that is still a real, payable result, not a void match. */
  isVoidMatch: boolean;
  /** Duel-only (winnerCount === 1): true when the top two ranked players are tied on every
   *  ranking criterion (score, wrong, forfeit state) — there is no fair way to pick a single
   *  winner, so the match voids and both entry fees are refunded instead. Always false when
   *  winnerCount > 1 (squad matches always produce a strict ranking, ties are broken by the
   *  same tiebreakers used for ranking so payouts stay deterministic). */
  isDraw: boolean;
  winnerIds: Set<string>;
  platformCut: number;
  winnerPayoutTotal: number;
  /** Exact payout per winner, keyed by userId. With two winners, 1st place gets
   *  FIRST_PLACE_SHARE of the winner pool and 2nd place gets the exact remainder
   *  (so the full winnerPayoutTotal is always allocated, never rounded away). If
   *  only one player is actually eligible to win, they take the entire pool alone. */
  payoutByUserId: Map<string, number>;
}

function compareRank(a: PayoutInputPlayer, b: PayoutInputPlayer): number {
  // A forfeiting player always ranks below every player who stayed connected to the end,
  // no matter what score they had banked at the moment they dropped.
  if (a.forfeited !== b.forfeited) return a.forfeited ? 1 : -1;
  if (b.score !== a.score) return b.score - a.score;
  if (a.wrong !== b.wrong) return a.wrong - b.wrong;
  const at = a.lastAnswerAt ?? Number.MAX_SAFE_INTEGER;
  const bt = b.lastAnswerAt ?? Number.MAX_SAFE_INTEGER;
  return at - bt;
}

/** True when a and b are indistinguishable by every ranking criterion this function uses —
 *  i.e. a genuine tie, not just an equal score that gets broken by wrong-count/timing. */
function isExactTie(a: PayoutInputPlayer, b: PayoutInputPlayer): boolean {
  return a.forfeited === b.forfeited && a.score === b.score && a.wrong === b.wrong;
}

/**
 * Pure, deterministic payout calculation — no I/O, no timers, no randomness.
 * Kept separate from the live room/match orchestration (`rooms.ts`) so it can
 * be unit-tested directly with contrived scores instead of depending on the
 * outcome of live (randomized) gameplay.
 *
 * Scoring model: correct answer = +1, wrong answer (or timeout) = -1, no elimination —
 * scores can be negative. "Highest score wins" literally, with no positive-score floor;
 * the only two special cases are `isVoidMatch` (nobody played at all) and `isDraw`
 * (duel-only exact tie at the top, see PayoutBreakdown above).
 *
 * `winnerCount` controls how many top scorers get paid: 1 for a 1v1 duel
 * (winner takes the entire winner pool, loser gets nothing) or 2 for a
 * 4-player squad match (top 2 scorers split the winner pool 60/40, best to
 * worst; the bottom 2 win nothing and are not refunded — their entry fee is
 * already part of the pool the winners split). Defaults to 2 (squad) to
 * match every existing caller.
 */
export function computeMatchPayout(pool: number, players: PayoutInputPlayer[], winnerCount = 2): PayoutBreakdown {
  const ranked = players.slice().sort(compareRank);

  const everyoneIdle = players.every((p) => p.correct + p.wrong === 0);
  const isVoidMatch = everyoneIdle;

  const top = ranked[0];
  const runnerUp = ranked[1];
  const isDraw = !isVoidMatch && winnerCount === 1 && !!top && !!runnerUp && isExactTie(top, runnerUp);

  const void_ = isVoidMatch || isDraw;
  const platformCut = void_ ? 0 : Math.round(pool * PLATFORM_FEE_RATE);
  const winnerPayoutTotal = pool - platformCut;

  const winners = void_ ? [] : ranked.slice(0, winnerCount);
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
    isDraw,
    winnerIds: new Set(winners.map((w) => w.userId)),
    platformCut,
    winnerPayoutTotal,
    payoutByUserId,
  };
}
