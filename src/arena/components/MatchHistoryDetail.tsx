import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from '../../components/common/Button';
import { fetchMatchDetail } from '../api';
import { MATCH_OUTCOME_LABELS, type MatchHistoryItem } from '../types';

interface MatchHistoryDetailProps {
  roomId: string;
  onBack: () => void;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  const seconds = Math.round(ms / 1000);
  return `${seconds}s`;
}

/** Full detail for exactly one real finished match this account took part in — fetched
 *  fresh by room id (never cached/guessed from the list view), and a 404 from the server
 *  (not this account's match) is shown as an honest "not found", not a crash. */
export function MatchHistoryDetail({ roomId, onBack }: MatchHistoryDetailProps) {
  const [match, setMatch] = useState<MatchHistoryItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchMatchDetail(roomId)
      .then((m) => {
        if (!cancelled) setMatch(m);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Match not found');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  return (
    <div className="history-detail no-select">
      <button type="button" className="profile-back" onClick={onBack}>
        ← Back to History
      </button>

      {loading && <p className="arena-empty">Loading match…</p>}
      {error && (
        <div className="history-empty glass-panel">
          <p className="arena-fineprint arena-fineprint--warn">{error}</p>
          <Button variant="secondary" size="md" onClick={onBack}>
            Back to history
          </Button>
        </div>
      )}

      {!loading && !error && match && (
        <motion.div className="history-detail__card glass-panel" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
          <span className={`history-row__badge history-row__badge--${match.outcome}`}>{MATCH_OUTCOME_LABELS[match.outcome]}</span>
          <h1 className="arena-title arena-title--sm">
            {match.formatLabel} · 🪙 {match.entryFee.toLocaleString()} entry
          </h1>
          <p className="arena-fineprint">
            {formatDate(match.endedAt)} · Duration {formatDuration(match.durationMs)} · {match.playerCount} players
          </p>

          <div className="history-detail__stats">
            <Stat label="Your score" value={`${match.yourScore ?? '—'}`} />
            <Stat label="Correct" value={`${match.yourCorrect ?? 0}`} />
            <Stat label="Wrong" value={`${match.yourWrong ?? 0}`} />
            <Stat label="Best streak" value={`${match.yourMaxStreak ?? 0}`} />
            <Stat label="Placement" value={match.placement ? `#${match.placement}` : '—'} />
            <Stat label="Payout" value={match.yourPayout && match.yourPayout > 0 ? `+🪙 ${match.yourPayout.toLocaleString()}` : '🪙 0'} />
          </div>

          <h2 className="arena-section__title">Opponents</h2>
          {match.opponents.length === 0 && <p className="arena-empty">No opponents recorded (e.g. a cancelled/void match).</p>}
          {match.opponents.length > 0 && (
            <ul className="history-detail__opponents">
              {match.opponents.map((o, i) => (
                <li key={`${o.name}-${i}`}>
                  <span>
                    {o.name}
                    {o.isWinner && ' 🏆'}
                  </span>
                  <span>{o.score} pts</span>
                </li>
              ))}
            </ul>
          )}
        </motion.div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="history-detail__stat">
      <span className="history-detail__stat-value">{value}</span>
      <span className="history-detail__stat-label">{label}</span>
    </div>
  );
}
