import { useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from '../../components/common/Button';
import { GAME_KIND_TAGLINES, ENTRY_FEE_TIERS, type ArenaUser, type RoomSummary } from '../types';
import gameThumbnail from '../../assets/images/memory-match-thumbnail.webp';

interface LobbyProps {
  user: ArenaUser;
  rooms: RoomSummary[];
  onRefresh: () => void;
  onCreateRoom: (entryFee: number) => void;
  onJoinRoom: (roomId: string) => void;
  onTopUp: (amount: number) => void;
}

const TOP_UP_OPTIONS = [500, 2000, 10000];

export function Lobby({ user, rooms, onRefresh, onCreateRoom, onJoinRoom, onTopUp }: LobbyProps) {
  const [selectedFee, setSelectedFee] = useState<number>(ENTRY_FEE_TIERS[0]);

  return (
    <div className="arena-lobby no-select">
      <header className="arena-lobby__header">
        <div>
          <h1 className="arena-title arena-title--sm">Wager Arena</h1>
          <p className="arena-subtitle arena-subtitle--sm">Hi {user.name}, stake your entry and jump in.</p>
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

      <section className="arena-game-feature glass-panel">
        <img className="arena-game-feature__art" src={gameThumbnail} alt="Memory Match" />
        <div className="arena-game-feature__body">
          <h2 className="arena-game-feature__title">🧠 Memory Match</h2>
          <p className="arena-game-feature__tagline">{GAME_KIND_TAGLINES.memoryMatch}</p>
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
          onClick={() => onCreateRoom(selectedFee)}
        >
          Create Room
        </Button>
        {user.walletBalance < selectedFee && (
          <p className="arena-fineprint arena-fineprint--warn">Top up your wallet to afford this entry fee.</p>
        )}
      </section>

      <section className="arena-section">
        <div className="arena-section__row">
          <h2 className="arena-section__title">Open rooms</h2>
          <button type="button" className="arena-link" onClick={onRefresh}>
            ↻ Refresh
          </button>
        </div>
        {rooms.length === 0 && <p className="arena-empty">No open rooms yet. Create one above to get started.</p>}
        <ul className="arena-room-list">
          {rooms.map((room) => (
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
    </div>
  );
}
