import { useMemo } from 'react';
import { Button } from '../../components/common/Button';
import { GAME_KIND_LABELS, roomFormatMeta, type ArenaUser, type RoomStatePublic } from '../types';
import type { ActiveRoundView } from '../useArena';
import { useNow } from '../useNow';
import { QuestionRenderer } from './QuestionRenderer';

interface RoomScreenProps {
  user: ArenaUser;
  room: RoomStatePublic;
  round: ActiveRoundView | null;
  onReady: () => void;
  onLeave: () => void;
  onAnswer: (optionToken: string) => void;
}

function formatSeconds(ms: number): string {
  return Math.max(0, Math.ceil(ms / 1000)).toString();
}

export function RoomScreen({ user, room, round, onReady, onLeave, onAnswer }: RoomScreenProps) {
  const now = useNow(100);
  const me = room.players.find((p) => p.id === user.id);
  const isReady = me?.ready ?? false;
  const formatMeta = roomFormatMeta(room.format);

  const leaderboard = useMemo(
    () => [...room.players].sort((a, b) => b.score - a.score || a.chancesLeft - b.chancesLeft),
    [room.players],
  );

  return (
    <div className="arena-room no-select">
      <header className="arena-room__header glass-panel">
        <div>
          <h1 className="arena-title arena-title--sm">{GAME_KIND_LABELS[room.gameKind]}</h1>
          <p className="arena-subtitle arena-subtitle--sm">
            {formatMeta.icon} {formatMeta.label} · Entry 🪙 {room.entryFee.toLocaleString()} · Pool 🪙{' '}
            {room.pool.toLocaleString()}
          </p>
        </div>
        {room.status === 'waiting' && (
          <div className="arena-room__actions">
            <Button variant={isReady ? 'secondary' : 'primary'} size="md" disabled={isReady} onClick={onReady}>
              {isReady ? 'Ready ✓' : "I'm Ready"}
            </Button>
            <Button variant="ghost" size="md" onClick={onLeave}>
              Leave
            </Button>
          </div>
        )}
        {room.status === 'countdown' && room.countdownEndsAt && (
          <div className="arena-countdown-badge">Starting in {formatSeconds(room.countdownEndsAt - now)}s</div>
        )}
        {room.status === 'live' && room.matchEndsAt && (
          <div className="arena-countdown-badge arena-countdown-badge--live">
            ⏱ {formatSeconds(room.matchEndsAt - now)}s
          </div>
        )}
      </header>

      <div className="arena-room__body">
        <main className="arena-room__main glass-panel">
          {room.status === 'waiting' && (
            <div className="arena-waiting">
              <p className="arena-empty">Waiting for all {formatMeta.players} players to be ready…</p>
              <p className="arena-fineprint">
                {room.players.length}/{formatMeta.players} seated · {formatMeta.tagline}
              </p>
            </div>
          )}

          {room.status === 'countdown' && (
            <div className="arena-waiting">
              <p className="arena-empty">Get ready! The match is about to begin.</p>
            </div>
          )}

          {room.status === 'live' && (
            <>
              {me && me.chancesLeft <= 0 && (
                <p className="arena-empty">You are out of chances — waiting for the timer to end…</p>
              )}
              {me && me.chancesLeft > 0 && !round && <p className="arena-empty">Loading next round…</p>}
              {me && me.chancesLeft > 0 && round && <QuestionRenderer round={round} now={now} onAnswer={onAnswer} />}
            </>
          )}

          {room.status === 'live' && me && (
            <div className="arena-self-stats">
              <span>Score: {me.score}</span>
              <span>Chances: {'❤️'.repeat(me.chancesLeft) || '—'}</span>
            </div>
          )}
        </main>

        <aside className="arena-leaderboard glass-panel">
          <h2 className="arena-section__title">Players</h2>
          <ul>
            {leaderboard.map((p, i) => (
              <li key={p.id} className={p.id === user.id ? 'arena-leaderboard__self' : ''}>
                <span className="arena-leaderboard__rank">{i + 1}</span>
                <span className="arena-leaderboard__name">
                  {p.name}
                  {!p.connected && ' (left)'}
                </span>
                <span className="arena-leaderboard__score">{p.score}</span>
                {room.status === 'waiting' && (
                  <span className="arena-leaderboard__ready">{p.ready ? '✓' : '…'}</span>
                )}
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
