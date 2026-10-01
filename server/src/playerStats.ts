/**
 * Player statistics + achievements — both derived entirely from the same real,
 * already-stored match history and wallet ledger (see admin/matchHistory.ts, wallet.ts).
 * Nothing here is a fabricated or sampled number: every field either comes straight out of
 * a real finished match's recorded result, or is a sum/average/max over those real
 * results. If this account has never finished a match, the match-dependent fields are
 * honestly `0`/`null` rather than a plausible-looking placeholder.
 */
import { matchHistoryForUser } from './admin/matchHistory.js';
import { getWalletStats } from './wallet.js';
import type { RoomFormat } from './types.js';

export interface FormatStats {
  played: number;
  wins: number;
  losses: number;
  draws: number;
}

export interface PlayerStats {
  memberSince: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number; // 0..1, 0 when gamesPlayed is 0
  highestScore: number;
  highestStreak: number;
  totalCorrect: number;
  totalWrong: number;
  averageScore: number;
  averageReactionMs: number | null;
  fastestReactionMs: number | null;
  byFormat: Record<RoomFormat, FormatStats>;
  // Wallet-side numbers (deposits/withdrawals/wagering) — kept alongside gameplay stats so
  // one endpoint can back the whole Stats screen without a second round-trip.
  totalWagered: number;
  totalWon: number;
  netGameProfit: number;
}

export function computePlayerStats(userId: string): PlayerStats {
  const history = matchHistoryForUser(userId).filter((m) => m.status === 'finished' && !m.isVoidMatch);
  const wallet = getWalletStats(userId);

  let wins = 0;
  let losses = 0;
  let draws = 0;
  let highestScore = 0;
  let highestStreak = 0;
  let totalCorrect = 0;
  let totalWrong = 0;
  let scoreSum = 0;
  let reactionMsWeightedSum = 0;
  let reactionCountTotal = 0;
  let fastestReactionMs: number | null = null;
  const byFormat: Record<RoomFormat, FormatStats> = {
    duel: { played: 0, wins: 0, losses: 0, draws: 0 },
    squad: { played: 0, wins: 0, losses: 0, draws: 0 },
  };

  for (const entry of history) {
    const mine = entry.results.find((r) => r.userId === userId);
    if (!mine) continue;
    const format = entry.format as RoomFormat;
    const fmtBucket = byFormat[format];
    if (fmtBucket) fmtBucket.played += 1;

    if (entry.isDraw) {
      draws += 1;
      if (fmtBucket) fmtBucket.draws += 1;
    } else if (mine.isWinner) {
      wins += 1;
      if (fmtBucket) fmtBucket.wins += 1;
    } else {
      losses += 1;
      if (fmtBucket) fmtBucket.losses += 1;
    }

    highestScore = Math.max(highestScore, mine.score);
    highestStreak = Math.max(highestStreak, mine.maxStreak);
    totalCorrect += mine.correct;
    totalWrong += mine.wrong;
    scoreSum += mine.score;
    if (mine.avgReactionMs !== null) {
      // Each match's own average is already over however many rounds it had — weight by
      // round count (correct+wrong, a real count of answered rounds) so a short match
      // can't skew the lifetime average as much as a long one.
      const roundsAnswered = mine.correct + mine.wrong;
      reactionMsWeightedSum += mine.avgReactionMs * roundsAnswered;
      reactionCountTotal += roundsAnswered;
    }
    if (mine.fastestReactionMs !== null) {
      fastestReactionMs = fastestReactionMs === null ? mine.fastestReactionMs : Math.min(fastestReactionMs, mine.fastestReactionMs);
    }
  }

  const gamesPlayed = history.length;
  return {
    memberSince: wallet.memberSince,
    gamesPlayed,
    wins,
    losses,
    draws,
    winRate: gamesPlayed > 0 ? wins / gamesPlayed : 0,
    highestScore,
    highestStreak,
    totalCorrect,
    totalWrong,
    averageScore: gamesPlayed > 0 ? Math.round((scoreSum / gamesPlayed) * 10) / 10 : 0,
    averageReactionMs: reactionCountTotal > 0 ? Math.round(reactionMsWeightedSum / reactionCountTotal) : null,
    fastestReactionMs,
    byFormat,
    totalWagered: wallet.totalWagered,
    totalWon: wallet.totalWon,
    netGameProfit: wallet.netGameProfit,
  };
}

// ---------------------------------------------------------------------------
// Achievements — computed fresh from the same real stats/history above every time they're
// requested (never a separately-persisted "unlocked" flag that could drift from the truth,
// and never something a client can set). unlockedAt is the real timestamp of whichever
// historical match first satisfied the condition, found by replaying history in
// chronological order — not "now" at request time.
// ---------------------------------------------------------------------------

export type AchievementStatus = 'locked' | 'in_progress' | 'unlocked';

export interface Achievement {
  id: string;
  title: string;
  description: string;
  status: AchievementStatus;
  progress: { current: number; target: number };
  unlockedAt: number | null;
}

interface Milestone {
  id: string;
  title: string;
  description: (target: number) => string;
  target: number;
}

const GAME_COUNT_MILESTONES: Milestone[] = [
  { id: 'games_1', title: 'First Game', description: () => 'Play your first match.', target: 1 },
  { id: 'games_5', title: 'Getting Started', description: (t) => `Play ${t} matches.`, target: 5 },
  { id: 'games_25', title: 'Regular', description: (t) => `Play ${t} matches.`, target: 25 },
  { id: 'games_100', title: 'Veteran', description: (t) => `Play ${t} matches.`, target: 100 },
];

const WIN_MILESTONES: Milestone[] = [{ id: 'win_1', title: 'First Win', description: () => 'Win your first match.', target: 1 }];

const STREAK_MILESTONES: Milestone[] = [
  { id: 'streak_3', title: 'On a Roll', description: (t) => `Reach a ${t}-answer correct streak in one match.`, target: 3 },
  { id: 'streak_5', title: 'Hot Streak', description: (t) => `Reach a ${t}-answer correct streak in one match.`, target: 5 },
  { id: 'streak_10', title: 'Unstoppable', description: (t) => `Reach a ${t}-answer correct streak in one match.`, target: 10 },
];

const SCORE_MILESTONES: Milestone[] = [
  { id: 'score_10', title: 'Sharp Eye', description: (t) => `Reach a score of ${t} in a single match.`, target: 10 },
  { id: 'score_25', title: 'Sharpshooter', description: (t) => `Reach a score of ${t} in a single match.`, target: 25 },
  { id: 'score_50', title: 'Eagle Eye', description: (t) => `Reach a score of ${t} in a single match.`, target: 50 },
];

/** A single match with no mistakes at all and at least this many correct answers — a
 *  meaningful bar given the match runs the full configured duration, not a trivially
 *  reachable one-round fluke. */
const PERFECT_MATCH_MIN_CORRECT = 10;

export function computeAchievements(userId: string): Achievement[] {
  const history = matchHistoryForUser(userId)
    .filter((m) => m.status === 'finished' && !m.isVoidMatch)
    .slice()
    .sort((a, b) => a.endedAt - b.endedAt); // chronological, oldest first, for accurate unlock timestamps

  const achievements: Achievement[] = [];

  function buildCountingAchievement(milestones: Milestone[], currentAt: (index: number) => number, achievedAt: (index: number) => boolean) {
    for (const m of milestones) {
      let unlockedAt: number | null = null;
      let current = 0;
      for (let i = 0; i < history.length; i += 1) {
        if (achievedAt(i)) current += 1;
        if (unlockedAt === null && current >= m.target) unlockedAt = history[i]!.endedAt;
      }
      achievements.push({
        id: m.id,
        title: m.title,
        description: m.description(m.target),
        status: unlockedAt !== null ? 'unlocked' : current > 0 ? 'in_progress' : 'locked',
        progress: { current: Math.min(current, m.target), target: m.target },
        unlockedAt,
      });
    }
    return currentAt;
  }

  buildCountingAchievement(
    GAME_COUNT_MILESTONES,
    () => history.length,
    () => true,
  );
  buildCountingAchievement(
    WIN_MILESTONES,
    () => history.filter((m) => m.winnerIds.includes(userId)).length,
    (i) => history[i]!.winnerIds.includes(userId),
  );

  // Streak + score milestones: "current" is the best-ever value reached by that point, not
  // a count — handled separately since the semantics differ from the counting achievements.
  for (const milestoneSet of [STREAK_MILESTONES, SCORE_MILESTONES]) {
    const isStreak = milestoneSet === STREAK_MILESTONES;
    let best = 0;
    const bestAtEnd: number[] = [];
    for (const entry of history) {
      const mine = entry.results.find((r) => r.userId === userId);
      const value = mine ? (isStreak ? mine.maxStreak : mine.score) : 0;
      best = Math.max(best, value);
      bestAtEnd.push(best);
    }
    for (const m of milestoneSet) {
      let unlockedAt: number | null = null;
      for (let i = 0; i < history.length; i += 1) {
        if (unlockedAt === null && bestAtEnd[i]! >= m.target) unlockedAt = history[i]!.endedAt;
      }
      achievements.push({
        id: m.id,
        title: m.title,
        description: m.description(m.target),
        status: unlockedAt !== null ? 'unlocked' : best > 0 ? 'in_progress' : 'locked',
        progress: { current: Math.min(best, m.target), target: m.target },
        unlockedAt,
      });
    }
  }

  // Perfect match — a single match, zero wrong answers, at least PERFECT_MATCH_MIN_CORRECT
  // correct. Binary (no partial progress bar makes sense for "one flawless match").
  let perfectUnlockedAt: number | null = null;
  for (const entry of history) {
    const mine = entry.results.find((r) => r.userId === userId);
    if (mine && mine.wrong === 0 && mine.correct >= PERFECT_MATCH_MIN_CORRECT) {
      perfectUnlockedAt = entry.endedAt;
      break;
    }
  }
  achievements.push({
    id: 'perfect_match',
    title: 'Flawless',
    description: `Finish a match with ${PERFECT_MATCH_MIN_CORRECT}+ correct answers and zero wrong answers.`,
    status: perfectUnlockedAt !== null ? 'unlocked' : 'locked',
    progress: { current: perfectUnlockedAt !== null ? 1 : 0, target: 1 },
    unlockedAt: perfectUnlockedAt,
  });

  return achievements;
}
