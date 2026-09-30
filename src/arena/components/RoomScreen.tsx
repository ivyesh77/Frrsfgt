import { useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { GAME_KIND_LABELS, initialsOf, roomFormatMeta, type ArenaUser, type RoomStatePublic } from '../types';
import type { ActiveRoundView } from '../useArena';
import { useNow } from '../useNow';
import { Matchmaking } from './Matchmaking';
import { QuestionRenderer } from './QuestionRenderer';

interface RoomScreenProps {
  user: ArenaUser;
  room: RoomStatePublic;
  round: ActiveRoundView | null;
  matchFoundToken: number;
  onReady: () => void;
  onLeave: () => void;
  onAnswer: (optionToken: string) => void;
}

function formatSeconds(ms: number): string {
  return Math.max(0, Math.ceil(ms / 1000)).toString();
}

export function RoomScreen({ user, room, round, matchFoundToken, onReady, onLeave, onAnswer }: RoomScreenProps) {
  const now = useNow(100);
  const me = room.players.find((p) => p.id === user.id);
  const formatMeta = roomFormatMeta(room.format);

  // "YOU" is always pinned to the top of the live scoreboard regardless of rank — everyone
  // else is sorted by their own authoritative server score. All numbers here come straight
  // from room.players (server-pushed on every score change); nothing is computed locally.
  const scoreboard = useMemo(() => {
    const others = room.players.filter((p) => p.id !== user.id).sort((a, b) => b.score - a.score);
    return me ? [me, ...others] : others;
  }, [room.players, user.id, me]);

  if (room.status !== 'active') {
    return <Matchmaking user={user} room={room} matchFoundToken={matchFoundToken} onReady={onReady} onLeave={onLeave} />;
  }

  return (
    <div className="arena-room no-select">
      <header className="arena-room__header glass-panel">
        <div>
          <h1 className="arena-title arena-title--sm">{GAME_KIND_LABELS[room.gameKind]}</h1>
          <p className="arena-subtitle arena-subtitle--sm">
            {formatMeta.icon} {formatMeta.label} · Pool 🪙 {room.pool.toLocaleString()}
          </p>
        </div>
        {room.matchEndsAt && (
          <div className="arena-countdown-badge arena-countdown-badge--live">⏱ {formatSeconds(room.matchEndsAt - now)}s</div>
        )}
      </header>

      <div className="arena-room__body">
        <main className="arena-room__main glass-panel">
          {me?.connectionState === 'forfeited' ? (
            <p className="arena-empty">You forfeited this match — waiting for it to finish for the others…</p>
          ) : (
            <>
              {!round && <p className="arena-empty">Loading next round…</p>}
              {round && <QuestionRenderer round={round} now={now} onAnswer={onAnswer} />}
            </>
          )}
        </main>

        <aside className="arena-leaderboard glass-panel">
          <h2 className="arena-section__title">{room.format === 'duel' ? 'Scoreboard' : 'Live Standings'}</h2>
          <ul>
            {scoreboard.map((p) => {
              const isSelf = p.id === user.id;
              return (
                <li key={p.id} className={isSelf ? 'arena-leaderboard__self' : ''}>
                  <span className="arena-leaderboard__avatar" aria-hidden="true">
                    {initialsOf(p.name)}
                  </span>
                  <span className="arena-leaderboard__name">
                    {isSelf ? 'You' : p.name}
                    {p.connectionState === 'disconnected' && ' · reconnecting…'}
                    {p.connectionState === 'forfeited' && ' · forfeited'}
                  </span>
                  <AnimatePresence mode="popLayout">
                    <motion.span
                      key={p.score}
                      className={`arena-leaderboard__score ${p.score < 0 ? 'arena-leaderboard__score--neg' : ''}`}
                      initial={{ y: -8, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ duration: 0.2 }}
                    >
                      {p.score}
                    </motion.span>
                  </AnimatePresence>
                </li>
              );
            })}
          </ul>
        </aside>
      </div>
    </div>
  );
}
