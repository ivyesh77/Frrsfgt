import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from '../../components/common/Button';
import { fetchMatchHistory, fetchPlayerStats } from '../api';
import { MATCH_OUTCOME_LABELS, type ArenaUser, type MatchHistoryItem, type PlayerStats } from '../types';
import { useReducedMotion } from '../useArenaPrefs';

interface DashboardHomeProps {
  user: ArenaUser;
  onPlay: () => void;
  onOpenWallet: () => void;
  onOpenHistory: () => void;
  onOpenMatch: (roomId: string) => void;
  /** Bumped by the parent whenever a match just finished, so this screen's "recent
   *  activity" preview refreshes with the real new result instead of going stale. */
  refreshToken: number;
}

/** The authenticated landing screen — a real dashboard built entirely from data this
 *  account actually has (wallet balance from the session user, lifetime stats and the 3
 *  most recent matches from the server). Never a mock widget: an account with zero match
 *  history simply shows an honest empty state and a "Play your first match" CTA instead of
 *  a sample card. */
export function DashboardHome({ user, onPlay, onOpenWallet, onOpenHistory, onOpenMatch, refreshToken }: DashboardHomeProps) {
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [recent, setRecent] = useState<MatchHistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    let cancelled = false;
    setError(null);
    Promise.all([fetchPlayerStats(), fetchMatchHistory({ page: 1, pageSize: 3 })])
      .then(([s, history]) => {
        if (cancelled) return;
        setStats(s);
        setRecent(history.items);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load your dashboard');
      });
    return () => {
      cancelled = true;
    };
  }, [user.id, refreshToken]);

  const fadeIn = reducedMotion ? {} : { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.25 } };

  return (
    <div className="dash no-select">
      <motion.section className="dash-hero glass-panel" {...fadeIn}>
        <div>
          <p className="dash-hero__greeting">Welcome back,</p>
          <h1 className="arena-title arena-title--sm">{user.name}</h1>
        </div>
        <div className="dash-hero__actions">
          <Button variant="primary" size="lg" onClick={onPlay}>
            ▶ Play Now
          </Button>
          <button type="button" className="dash-hero__wallet" onClick={onOpenWallet}>
            🪙 {user.walletBalance.toLocaleString()} ARC <span>Wallet →</span>
          </button>
        </div>
      </motion.section>

      {error && <p className="arena-fineprint arena-fineprint--warn">{error}</p>}

      <section className="dash-quickstats" aria-label="Quick stats">
        <QuickStat label="Matches played" value={stats ? stats.gamesPlayed.toLocaleString() : '—'} />
        <QuickStat label="Wins" value={stats ? stats.wins.toLocaleString() : '—'} />
        <QuickStat label="Win rate" value={stats ? `${Math.round(stats.winRate * 100)}%` : '—'} />
        <QuickStat label="Best streak" value={stats ? stats.highestStreak.toLocaleString() : '—'} />
      </section>

      <section className="dash-section">
        <div className="dash-section__header">
          <h2 className="arena-section__title">Recent matches</h2>
          <button type="button" className="dash-section__link" onClick={onOpenHistory}>
            View all →
          </button>
        </div>

        {recent === null && !error && <p className="arena-empty">Loading…</p>}
        {recent !== null && recent.length === 0 && (
          <div className="dash-empty glass-panel">
            <p>You haven&rsquo;t played a match yet.</p>
            <Button variant="secondary" size="md" onClick={onPlay}>
              Play your first match
            </Button>
          </div>
        )}
        {recent !== null && recent.length > 0 && (
          <ul className="dash-recent-list">
            {recent.map((m) => (
              <li key={m.roomId}>
                <button type="button" className={`dash-recent-item outcome-${m.outcome}`} onClick={() => onOpenMatch(m.roomId)}>
                  <span className={`dash-recent-item__badge dash-recent-item__badge--${m.outcome}`}>{MATCH_OUTCOME_LABELS[m.outcome]}</span>
                  <span className="dash-recent-item__meta">
                    {m.formatLabel} · 🪙 {m.entryFee.toLocaleString()}
                  </span>
                  <span className="dash-recent-item__score">{m.yourScore ?? '—'} pts</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function QuickStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="dash-quickstat glass-panel">
      <span className="dash-quickstat__value">{value}</span>
      <span className="dash-quickstat__label">{label}</span>
    </div>
  );
}
