import { useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from '../../components/common/Button';
import {
  ENTRY_FEE_TIERS,
  GAME_KINDS,
  GAME_KIND_ICONS,
  GAME_KIND_LABELS,
  GAME_KIND_TAGLINES,
  type ArenaUser,
  type GameKind,
  type RoomSummary,
} from '../types';

interface LobbyProps {
  user: ArenaUser;
  rooms: RoomSummary[];
  onRefresh: (gameKind?: GameKind) => void;
  onCreateRoom: (gameKind: GameKind, entryFee: number) => void;
  onJoinRoom: (roomId: string) => void;
  onTopUp: (amount: number) => void;
  onBack: () => void;
}

const TOP_UP_OPTIONS = [500, 2000, 10000];

export function Lobby({ user, rooms, onRefresh, onCreateRoom, onJoinRoom, onTopUp, onBack }: LobbyProps) {
  const [selectedKind, setSelectedKind] = useState<GameKind>('memoryMatch');
  const [selectedFee, setSelectedFee] = useState<number>(ENTRY_FEE_TIERS[0]);

  const visibleRooms = rooms.filter((r) => r.gameKind === selectedKind);

  return (
    <div className="arena-lobby no-select">
      <header className="arena-lobby__header">
        <div>
          <h1 className="arena-title arena-title--sm">Wager Arena</h1>
          <p className="arena-subtitle arena-subtitle--sm">Hi {user.name}, pick a game and stake your entry.</p>
        </div>
        <div className="arena-wallet glass-panel">
          <span className="arena-wallet__label">Wallet</span>
          <span className="arena-wallet__value">🪙 {user.walletBalance.toLocaleString()}</span>
          <div className="arena-wallet__topups">
            {TOP_UP_OPTIONS.map((amount) => (
              <button key={amount} type="button" className="arena-chip" onClick={() => onTopUp(amount)}>
                +{amount}
              </button>
            ))}
          </div>
        </div>
      </header>

      <section className="arena-section">
        <h2 className="arena-section__title">Choose a game</h2>
        <div className="arena-game-grid">
          {GAME_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              className={`arena-game-card ${kind === selectedKind ? 'arena-game-card--active' : ''}`}
              onClick={() => {
                setSelectedKind(kind);
                onRefresh(kind);
              }}
            >
              <span className="arena-game-card__icon">{GAME_KIND_ICONS[kind]}</span>
              <span className="arena-game-card__label">{GAME_KIND_LABELS[kind]}</span>
              <span className="arena-game-card__tagline">{GAME_KIND_TAGLINES[kind]}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="arena-section">
        <h2 className="arena-section__title">Entry fee</h2>
        <div className="arena-fee-row">
          {ENTRY_FEE_TIERS.map((fee) => (
            <button
              key={fee}
              type="button"
              className={`arena-chip arena-chip--fee ${fee === selectedFee ? 'arena-chip--active' : ''}`}
              onClick={() => setSelectedFee(fee)}
            >
              🪙 {fee.toLocaleString()}
            </button>
          ))}
        </div>
        <Button
          variant="primary"
          size="lg"
          className="arena-create-btn"
          disabled={user.walletBalance < selectedFee}
          onClick={() => onCreateRoom(selectedKind, selectedFee)}
        >
          Create Room · {GAME_KIND_LABELS[selectedKind]}
        </Button>
        {user.walletBalance < selectedFee && (
          <p className="arena-fineprint arena-fineprint--warn">Top up your wallet to afford this entry fee.</p>
        )}
      </section>

      <section className="arena-section">
        <div className="arena-section__row">
          <h2 className="arena-section__title">Open rooms · {GAME_KIND_LABELS[selectedKind]}</h2>
          <button type="button" className="arena-link" onClick={() => onRefresh(selectedKind)}>
            ↻ Refresh
          </button>
        </div>
        {visibleRooms.length === 0 && (
          <p className="arena-empty">No open rooms yet for this game. Create one above to get started.</p>
        )}
        <ul className="arena-room-list">
          {visibleRooms.map((room) => (
            <motion.li
              key={room.id}
              className="arena-room-row glass-panel"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <div className="arena-room-row__info">
                <span className="arena-room-row__fee">🪙 {room.entryFee.toLocaleString()} entry</span>
                <span className="arena-room-row__meta">
                  {room.playerCount}/{room.maxPlayers} players · {room.status}
                </span>
              </div>
              <Button
                variant="secondary"
                size="md"
                disabled={room.status !== 'waiting' || user.walletBalance < room.entryFee}
                onClick={() => onJoinRoom(room.id)}
              >
                Join
              </Button>
            </motion.li>
          ))}
        </ul>
      </section>

      <button type="button" className="arena-link arena-link--back" onClick={onBack}>
        ← Back to Classic mode
      </button>
    </div>
  );
}
