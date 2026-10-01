import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { fetchAchievements } from '../api';
import type { Achievement } from '../types';
import { useReducedMotion } from '../useArenaPrefs';

interface AchievementsScreenProps {
  onBack: () => void;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Achievements are computed fresh server-side from real match history every request (see
 *  server/src/playerStats.ts computeAchievements) — never a client-trusted "unlocked" flag.
 *  Locked/in-progress/unlocked states and real progress bars/unlock dates all come straight
 *  from that computation. */
export function AchievementsScreen({ onBack }: AchievementsScreenProps) {
  const [achievements, setAchievements] = useState<Achievement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    let cancelled = false;
    fetchAchievements()
      .then((a) => {
        if (!cancelled) setAchievements(a);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load achievements');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const unlockedCount = achievements?.filter((a) => a.status === 'unlocked').length ?? 0;

  return (
    <div className="achievements-screen no-select">
      <button type="button" className="profile-back" onClick={onBack}>
        ← Back to Profile
      </button>
      <h1 className="arena-title arena-title--sm">Achievements</h1>
      {achievements && <p className="arena-subtitle arena-subtitle--sm">{unlockedCount} of {achievements.length} unlocked</p>}

      {error && <p className="arena-fineprint arena-fineprint--warn">{error}</p>}
      {!achievements && !error && <p className="arena-empty">Loading…</p>}

      {achievements && (
        <ul className="achievements-grid">
          {achievements.map((a, i) => (
            <motion.li
              key={a.id}
              className={`achievement-card glass-panel achievement-card--${a.status}`}
              initial={reducedMotion ? undefined : { opacity: 0, y: 10 }}
              animate={reducedMotion ? undefined : { opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i, 10) * 0.03, duration: 0.2 }}
            >
              <span className="achievement-card__icon" aria-hidden="true">
                {a.status === 'unlocked' ? '🏆' : a.status === 'in_progress' ? '🔓' : '🔒'}
              </span>
              <div className="achievement-card__body">
                <h3 className="achievement-card__title">{a.title}</h3>
                <p className="achievement-card__desc">{a.description}</p>
                <div className="achievement-card__progress-track">
                  <div
                    className="achievement-card__progress-fill"
                    style={{ width: `${Math.round((a.progress.current / a.progress.target) * 100)}%` }}
                  />
                </div>
                <span className="achievement-card__progress-label">
                  {a.progress.current} / {a.progress.target}
                  {a.status === 'unlocked' && a.unlockedAt && ` · Unlocked ${formatDate(a.unlockedAt)}`}
                </span>
              </div>
            </motion.li>
          ))}
        </ul>
      )}
    </div>
  );
}
