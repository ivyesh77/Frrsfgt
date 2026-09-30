/**
 * Computes real risk signals from real, already-collected server data. These are
 * explicitly SIGNALS for an operator to review, never automatic proof of wrongdoing or an
 * automatic account action — nothing in this module suspends/bans/blocks anyone; it only
 * surfaces evidence (see users.ts for the actual, separately-authorized moderation
 * actions an operator can take after reviewing a signal).
 */
import { listAllTransactionsRaw, listAllUsersRaw } from '../store.js';
import { countAllEvents, countEvent, topSubjects } from './signals.js';
import { listLoginAttempts } from './store.js';
import type { RiskSignal, RiskSeverity } from './types.js';
import { nanoid } from 'nanoid';

function severityForCount(count: number, thresholds: [number, RiskSeverity][]): RiskSeverity | null {
  for (const [min, sev] of thresholds.slice().sort((a, b) => b[0] - a[0])) {
    if (count >= min) return sev;
  }
  return null;
}

/** Computed fresh on every request (this dataset is small enough in this product's scale
 *  that there's no need for a background job/cache) — never stored as a stale snapshot
 *  that could mislead an operator about current risk. */
export function computeRiskSignals(): RiskSignal[] {
  const signals: RiskSignal[] = [];
  const users = listAllUsersRaw();
  const usersById = new Map(users.map((u) => [u.id, u]));
  const transactions = listAllTransactionsRaw();

  // 1. Repeated failed logins per username within the last hour.
  const recentFailed = listLoginAttempts().filter((a) => a.actor === 'player' && !a.success && a.timestamp > Date.now() - 60 * 60 * 1000);
  const failsByName = new Map<string, number>();
  for (const attempt of recentFailed) failsByName.set(attempt.usernameAttempted, (failsByName.get(attempt.usernameAttempted) ?? 0) + 1);
  for (const [name, count] of failsByName) {
    const severity = severityForCount(count, [
      [5, 'medium'],
      [10, 'high'],
      [20, 'critical'],
    ]);
    if (severity) {
      signals.push({
        id: nanoid(10),
        userId: null,
        userName: name,
        kind: 'repeated_failed_login',
        severity,
        detail: `${count} failed login attempt(s) against "${name}" in the last hour`,
        createdAt: Date.now(),
        evidence: { count, windowMs: 60 * 60 * 1000 },
      });
    }
  }

  // 2. Rapid account creation from the same short window (proxy for scripted signups —
  // this product does not currently capture signup IP, so this looks at raw creation-time
  // clustering as an honest, disclosed approximation rather than a true per-IP signal).
  const sorted = users.slice().sort((a, b) => a.createdAt - b.createdAt);
  for (let i = 0; i + 4 < sorted.length; i += 1) {
    const windowStart = sorted[i]!.createdAt;
    const windowEnd = sorted[i + 4]!.createdAt;
    if (windowEnd - windowStart < 10_000) {
      signals.push({
        id: nanoid(10),
        userId: sorted[i + 4]!.id,
        userName: sorted[i + 4]!.name,
        kind: 'rapid_account_creation',
        severity: 'medium',
        detail: `5 accounts created within ${windowEnd - windowStart}ms of each other`,
        createdAt: Date.now(),
        evidence: { accountIds: sorted.slice(i, i + 5).map((u) => u.id) },
      });
      break; // one representative signal is enough — avoid flooding the list with overlaps
    }
  }

  // 3. Repeated withdrawal attempts in a short window per user.
  const withdrawalsByUser = new Map<string, number>();
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const tx of transactions) {
    if (tx.type !== 'withdrawal' || tx.timestamp < cutoff) continue;
    withdrawalsByUser.set(tx.userId, (withdrawalsByUser.get(tx.userId) ?? 0) + 1);
  }
  for (const [userId, count] of withdrawalsByUser) {
    const severity = severityForCount(count, [
      [5, 'medium'],
      [10, 'high'],
    ]);
    if (severity) {
      const user = usersById.get(userId);
      signals.push({
        id: nanoid(10),
        userId,
        userName: user?.name ?? null,
        kind: 'repeated_withdrawal_attempts',
        severity,
        detail: `${count} withdrawal(s) in the last hour`,
        createdAt: Date.now(),
        evidence: { count },
      });
    }
  }

  // 4. Excessive reconnects (real, server-recorded disconnect/reconnect cycles — see
  // rooms.ts markDisconnected/reconnect calling recordEvent('reconnect', userId)).
  for (const { subject, count } of topSubjects('reconnect', 30 * 60_000, 10)) {
    const severity = severityForCount(count, [
      [5, 'medium'],
      [10, 'high'],
    ]);
    if (severity) {
      const user = usersById.get(subject);
      signals.push({
        id: nanoid(10),
        userId: subject,
        userName: user?.name ?? null,
        kind: 'excessive_reconnects',
        severity,
        detail: `${count} disconnect/reconnect cycle(s) in the last 30 minutes`,
        createdAt: Date.now(),
        evidence: { count },
      });
    }
  }

  // 5. Excessive room/queue joins per user (rapid room creation).
  for (const { subject, count } of topSubjects('queueJoin', 60 * 60_000, 10)) {
    const severity = severityForCount(count, [
      [15, 'medium'],
      [30, 'high'],
    ]);
    if (severity) {
      const user = usersById.get(subject);
      signals.push({
        id: nanoid(10),
        userId: subject,
        userName: user?.name ?? null,
        kind: 'excessive_room_joins',
        severity,
        detail: `${count} matchmaking queue join(s) in the last hour`,
        createdAt: Date.now(),
        evidence: { count },
      });
    }
  }

  return signals.sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.createdAt - a.createdAt);
}

function severityRank(s: RiskSeverity): number {
  return { low: 0, medium: 1, high: 2, critical: 3 }[s];
}

/** Anti-cheat-specific view: counts of the exact server-side gameplay rejections already
 *  enforced by rooms.ts/index.ts (never a new, separate "client-side" anti-cheat) — this is
 *  purely a read of real, already-enforced decisions. */
export function computeAntiCheatSummary() {
  return {
    rateLimitedAnswersLastHour: countAllEvents('answerRateLimited', 60 * 60_000),
    staleRoundRejectionsLastHour: countAllEvents('staleRoundRejected', 60 * 60_000),
    tooFastRejectionsLastHour: countAllEvents('tooFastRejected', 60 * 60_000),
    timeoutsLastHour: countAllEvents('roundTimeout', 60 * 60_000),
    nonMemberAttemptsLastHour: countAllEvents('nonMemberAnswerAttempt', 60 * 60_000),
    flaggedPlayers: [
      ...topSubjects('staleRoundRejected', 60 * 60_000, 10),
      ...topSubjects('tooFastRejected', 60 * 60_000, 10),
    ].reduce<Array<{ subject: string; count: number }>>((acc, entry) => {
      const existing = acc.find((e) => e.subject === entry.subject);
      if (existing) existing.count += entry.count;
      else acc.push({ ...entry });
      return acc;
    }, []),
  };
}

export function subjectAnswerRate(userId: string): { answersLastMinute: number } {
  return { answersLastMinute: countEvent('answerSubmitted', userId, 60_000) };
}
