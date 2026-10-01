import { useEffect, useState } from 'react';
import { fetchPlayerStats } from '../api';
import type { PlayerStats } from '../types';

interface StatsScreenProps {
  onBack: () => void;
}

function formatMs(ms: number | null): string {
  if (ms === null) return '—';
  return `${(ms / 1000).toFixed(2)}s`;
}

/** Lifetime stats computed server-side fresh every request from the real match ledger —
 *  see server/src/playerStats.ts. An account that has never finished a match sees honest
 *  zeroes/dashes here, never a sample/placeholder number. */
export function StatsScreen({ onBack }: StatsScreenProps) {
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPlayerStats()
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load stats');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="stats-screen no-select">
      <button type="button" className="profile-back" onClick={onBack}>
        ← Back to Profile
      </button>
      <h1 className="arena-title arena-title--sm">Lifetime Stats</h1>

      {error && <p className="arena-fineprint arena-fineprint--warn">{error}</p>}
      {!stats && !error && <p className="arena-empty">Loading…</p>}

      {stats && (
        <>
          <section className="arena-section">
            <h2 className="arena-section__title">Overview</h2>
            <div className="profile-stats-grid">
              <StatCard label="Matches played" value={stats.gamesPlayed.toLocaleString()} />
              <StatCard label="Wins" value={stats.wins.toLocaleString()} />
              <StatCard label="Losses" value={stats.losses.toLocaleString()} />
              <StatCard label="Draws" value={stats.draws.toLocaleString()} />
              <StatCard label="Win rate" value={`${Math.round(stats.winRate * 100)}%`} />
              <StatCard label="Highest score" value={stats.highestScore.toLocaleString()} />
              <StatCard label="Best streak" value={stats.highestStreak.toLocaleString()} />
              <StatCard label="Average score" value={stats.averageScore.toLocaleString()} />
            </div>
          </section>

          <section className="arena-section">
            <h2 className="arena-section__title">Accuracy &amp; speed</h2>
            <div className="profile-stats-grid">
              <StatCard label="Total correct" value={stats.totalCorrect.toLocaleString()} />
              <StatCard label="Total wrong" value={stats.totalWrong.toLocaleString()} />
              <StatCard label="Avg. reaction time" value={formatMs(stats.averageReactionMs)} />
              <StatCard label="Fastest reaction" value={formatMs(stats.fastestReactionMs)} />
            </div>
          </section>

          <section className="arena-section">
            <h2 className="arena-section__title">By format</h2>
            <div className="profile-stats-grid">
              <StatCard label="1v1 Duel played" value={stats.byFormat.duel.played.toLocaleString()} />
              <StatCard label="1v1 Duel wins" value={stats.byFormat.duel.wins.toLocaleString()} />
              <StatCard label="Squad played" value={stats.byFormat.squad.played.toLocaleString()} />
              <StatCard label="Squad wins" value={stats.byFormat.squad.wins.toLocaleString()} />
            </div>
          </section>

          <section className="arena-section">
            <h2 className="arena-section__title">Wagering</h2>
            <div className="profile-stats-grid">
              <StatCard label="Total wagered" value={`🪙 ${stats.totalWagered.toLocaleString()}`} />
              <StatCard label="Total won" value={`🪙 ${stats.totalWon.toLocaleString()}`} />
              <StatCard
                label="Net profit / loss"
                value={`${stats.netGameProfit > 0 ? '+' : ''}🪙 ${stats.netGameProfit.toLocaleString()}`}
                tone={stats.netGameProfit > 0 ? 'positive' : stats.netGameProfit < 0 ? 'negative' : undefined}
              />
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: 'positive' | 'negative' }) {
  return (
    <div className="profile-stat glass-panel">
      <span className="profile-stat__label">{label}</span>
      <span className={`profile-stat__value ${tone ? `profile-stat__value--${tone}` : ''}`}>{value}</span>
    </div>
  );
}
