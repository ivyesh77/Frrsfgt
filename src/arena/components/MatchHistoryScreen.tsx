import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { fetchMatchHistory } from '../api';
import { MATCH_OUTCOME_LABELS, type MatchHistoryItem, type MatchOutcome, type PaginatedMatchHistory, type RoomFormat } from '../types';
import { useReducedMotion } from '../useArenaPrefs';

interface MatchHistoryScreenProps {
  onOpenMatch: (roomId: string) => void;
}

type FormatFilter = 'all' | RoomFormat;
type OutcomeFilter = 'all' | MatchOutcome;

const PAGE_SIZE = 10;

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Server-paginated, server-filtered match history — a client never fetches "everything"
 *  and slices it locally; every filter/page change issues a fresh request for exactly the
 *  page the server says exists (see GET /api/match-history). */
export function MatchHistoryScreen({ onOpenMatch }: MatchHistoryScreenProps) {
  const [format, setFormat] = useState<FormatFilter>('all');
  const [outcome, setOutcome] = useState<OutcomeFilter>('all');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PaginatedMatchHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchMatchHistory({ page, pageSize: PAGE_SIZE, format, outcome })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load match history');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [format, outcome, page]);

  function changeFormat(next: FormatFilter) {
    setFormat(next);
    setPage(1);
  }
  function changeOutcome(next: OutcomeFilter) {
    setOutcome(next);
    setPage(1);
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="history-screen no-select">
      <header className="screen-header">
        <h1 className="arena-title arena-title--sm">Match History</h1>
        <p className="arena-subtitle arena-subtitle--sm">Every real match you&rsquo;ve finished, straight from the server ledger.</p>
      </header>

      <div className="history-filters">
        <FilterGroup label="Format" active={format} onChange={changeFormat} options={[
          { id: 'all', label: 'All' },
          { id: 'duel', label: '1v1 Duel' },
          { id: 'squad', label: '4-Player Squad' },
        ]} />
        <FilterGroup label="Outcome" active={outcome} onChange={changeOutcome} options={[
          { id: 'all', label: 'All' },
          { id: 'win', label: 'Wins' },
          { id: 'loss', label: 'Losses' },
          { id: 'draw', label: 'Draws' },
          { id: 'void', label: 'Void' },
        ]} />
      </div>

      {loading && <p className="arena-empty">Loading match history…</p>}
      {error && <p className="arena-fineprint arena-fineprint--warn">{error}</p>}

      {!loading && !error && data && data.items.length === 0 && (
        <div className="history-empty glass-panel">
          <p>No matches match these filters yet.</p>
        </div>
      )}

      {!loading && !error && data && data.items.length > 0 && (
        <ul className="history-list">
          {data.items.map((m, i) => (
            <HistoryRow key={m.roomId} match={m} index={i} reducedMotion={reducedMotion} onClick={() => onOpenMatch(m.roomId)} />
          ))}
        </ul>
      )}

      {data && totalPages > 1 && (
        <div className="history-pager">
          <button type="button" className="arena-chip" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            ← Prev
          </button>
          <span className="arena-fineprint">
            Page {data.page} of {totalPages}
          </span>
          <button type="button" className="arena-chip" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

function HistoryRow({ match, index, reducedMotion, onClick }: { match: MatchHistoryItem; index: number; reducedMotion: boolean; onClick: () => void }) {
  const motionProps = reducedMotion
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { delay: Math.min(index, 6) * 0.03, duration: 0.2 } };
  return (
    <motion.li {...motionProps}>
      <button type="button" className="history-row glass-panel" onClick={onClick}>
        <span className={`history-row__badge history-row__badge--${match.outcome}`}>{MATCH_OUTCOME_LABELS[match.outcome]}</span>
        <span className="history-row__main">
          <span className="history-row__title">
            {match.formatLabel} · 🪙 {match.entryFee.toLocaleString()} entry
          </span>
          <span className="history-row__meta">{formatDate(match.endedAt)}</span>
        </span>
        <span className="history-row__stats">
          <span>{match.yourScore ?? '—'} pts</span>
          <span className="history-row__stats-sub">
            ✓{match.yourCorrect ?? 0} ✕{match.yourWrong ?? 0}
          </span>
        </span>
        <span className="history-row__payout">{match.yourPayout && match.yourPayout > 0 ? `+🪙 ${match.yourPayout.toLocaleString()}` : '—'}</span>
      </button>
    </motion.li>
  );
}

function FilterGroup<T extends string>({ label, active, options, onChange }: { label: string; active: T; options: Array<{ id: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <div className="history-filter-group" role="group" aria-label={label}>
      <span className="history-filter-group__label">{label}</span>
      <div className="history-filter-group__chips">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            className={`arena-chip ${active === o.id ? 'arena-chip--active' : ''}`}
            aria-pressed={active === o.id}
            onClick={() => onChange(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
