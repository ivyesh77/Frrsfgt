import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { roomFormatMeta, initialsOf, type ArenaUser, type RoomPlayerPublic, type RoomStatePublic } from '../types';
import { useNow } from '../useNow';
import { Button } from '../../components/common/Button';
import { sounds } from '../sound';
import { haptics } from '../haptics';

interface MatchmakingProps {
  user: ArenaUser;
  room: RoomStatePublic;
  matchFoundToken: number;
  onReady: () => void;
  onLeave: () => void;
}

function Avatar({ name, size = 56 }: { name: string; size?: number }) {
  return (
    <div className="arena-avatar" style={{ width: size, height: size, fontSize: size * 0.36 }} aria-hidden="true">
      {initialsOf(name)}
    </div>
  );
}

function secondsLeft(deadline: number | null, now: number): number {
  if (deadline === null) return 0;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

/**
 * The full pre-match flow, rendered purely from server-pushed state — `room.status` and
 * `room.players` are the only sources of truth here. Nothing on this screen is a fake or
 * simulated player: every card is a real, authenticated occupant the server actually seated
 * (see server/src/rooms.ts queueJoin/enterReadyCheck). This covers:
 *   queued      -> "Finding Match" search animation + live slot-filling.
 *   ready_check -> "Match Found" opponent-card entrance + ready-up.
 *   starting    -> server-driven 3-2-1-GO countdown.
 */
export function Matchmaking({ user, room, matchFoundToken, onReady, onLeave }: MatchmakingProps) {
  const now = useNow(100);
  const formatMeta = roomFormatMeta(room.format);
  const me = room.players.find((p) => p.id === user.id);
  const opponents = room.players.filter((p) => p.id !== user.id);
  const emptySeats = Math.max(0, formatMeta.players - room.players.length);
  const readySeconds = secondsLeft(room.readyDeadline, now);
  const startSeconds = secondsLeft(room.startsAt, now);
  const goCount = room.startsAt !== null ? Math.max(1, Math.ceil((room.startsAt - now) / 1000)) : 1;

  // One tick sound/haptic per distinct displayed count (3, 2, 1, GO), driven purely by the
  // server-owned `startsAt` deadline — never a client-side timer of its own.
  const lastTickRef = useRef<number | null>(null);
  useEffect(() => {
    if (room.status !== 'starting') {
      lastTickRef.current = null;
      return;
    }
    const current = startSeconds <= 0 ? 0 : goCount;
    if (lastTickRef.current === current) return;
    lastTickRef.current = current;
    if (current <= 0) {
      sounds.countdownGo();
      haptics.tap();
    } else {
      sounds.countdownTick();
      haptics.countdownTick();
    }
  }, [room.status, goCount, startSeconds]);

  if (room.status === 'starting') {
    return (
      <div className="arena-matchmaking arena-matchmaking--countdown">
        <AnimatePresence mode="wait">
          <motion.div
            key={goCount <= 0 ? 'go' : goCount}
            className="arena-go-countdown"
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 1.6, opacity: 0 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
          >
            {startSeconds <= 0 ? 'GO!' : startSeconds}
          </motion.div>
        </AnimatePresence>
        <p className="arena-fineprint">Get ready — the match starts the instant this hits zero.</p>
      </div>
    );
  }

  return (
    <div className="arena-matchmaking glass-panel">
      {room.status === 'queued' && (
        <div className="arena-matchmaking__searching">
          <div className="arena-search-pulse" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <h2 className="arena-title arena-title--sm">Finding Match…</h2>
          <p className="arena-fineprint">
            {formatMeta.label} · Entry 🪙 {room.entryFee.toLocaleString()} · {room.players.length}/{formatMeta.players} seated
          </p>
        </div>
      )}

      {room.status === 'ready_check' && (
        <motion.div
          key={matchFoundToken}
          className="arena-matchmaking__found"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <motion.h2
            className="arena-title arena-title--sm arena-matchmaking__found-title"
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 16 }}
          >
            ⚡ Match Found!
          </motion.h2>
          {room.readyDeadline && <p className="arena-fineprint">Ready up within {readySeconds}s or the match is cancelled and refunded.</p>}
        </motion.div>
      )}

      <div className={`arena-slots arena-slots--${formatMeta.id}`}>
        {me && <PlayerSlot player={me} isSelf index={0} />}
        {opponents.map((p, i) => (
          <PlayerSlot key={p.id} player={p} isSelf={false} index={i + 1} />
        ))}
        {Array.from({ length: emptySeats }).map((_, i) => (
          <EmptySlot key={`empty-${i}`} />
        ))}
      </div>

      {room.status === 'ready_check' && me && (
        <div className="arena-matchmaking__actions">
          <Button variant={me.ready ? 'secondary' : 'primary'} size="lg" disabled={me.ready} onClick={onReady}>
            {me.ready ? 'Ready ✓' : "I'm Ready"}
          </Button>
          <Button variant="ghost" size="md" onClick={onLeave}>
            Leave
          </Button>
        </div>
      )}
      {room.status === 'queued' && (
        <Button variant="ghost" size="md" onClick={onLeave}>
          Cancel search
        </Button>
      )}
    </div>
  );
}

function PlayerSlot({ player, isSelf, index }: { player: RoomPlayerPublic; isSelf: boolean; index: number }) {
  return (
    <motion.div
      className={`arena-slot arena-slot--filled ${isSelf ? 'arena-slot--self' : ''}`}
      initial={{ opacity: 0, scale: 0.6, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ delay: index * 0.12, type: 'spring', stiffness: 240, damping: 18 }}
    >
      <Avatar name={player.name} />
      <span className="arena-slot__name">
        {isSelf ? 'You' : player.name}
        {player.connectionState === 'disconnected' && ' · reconnecting…'}
        {player.connectionState === 'forfeited' && ' · left'}
      </span>
      <AnimatePresence>
        {player.ready && (
          <motion.span
            className="arena-ready-badge"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 14 }}
          >
            ✓ Ready
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function EmptySlot() {
  return (
    <div className="arena-slot arena-slot--empty">
      <div className="arena-avatar arena-avatar--empty" aria-hidden="true" />
      <span className="arena-slot__name arena-slot__name--muted">Searching…</span>
    </div>
  );
}
