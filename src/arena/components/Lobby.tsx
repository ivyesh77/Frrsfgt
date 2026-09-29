import { useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from '../../components/common/Button';
import { WalletModal } from './WalletModal';
import {
  GAME_KIND_TAGLINES,
  ENTRY_FEE_TIERS,
  MAX_PLAYERS_PER_ROOM,
  winnerShareOf,
  splitWinnerPayout,
  type ArenaUser,
  type RoomSummary,
} from '../types';
import gameThumbnail from '../../assets/images/memory-match-thumbnail.webp';

interface LobbyProps {
  user: ArenaUser;
  rooms: RoomSummary[];
  onRefresh: () => void;
  onCreateRoom: (entryFee: number) => void;
  onJoinRoom: (roomId: string) => void;
  onTopUp: (amount: number) => Promise<void> | void;
}

export function Lobby({ user, rooms, onRefresh, onCreateRoom, onJoinRoom, onTopUp }: LobbyProps) {
  const [selectedFee, setSelectedFee] = useState<number>(ENTRY_FEE_TIERS[0]);
  const [walletOpen, setWalletOpen] = useState(false);

  const selectedSplit = splitWinnerPayout(winnerShareOf(selectedFee * MAX_PLAYERS_PER_ROOM));

  return (
    <div className="arena-lobby no-select">
      <header className="arena-lobby__header">
        <div>
          <h1 className="arena-title arena-title--sm">Wager Arena</h1>
          <p className="arena-subtitle arena-subtitle--sm">Hi {user.name}, stake your entry and jump in.</p>
        </div>
        <button type="button" className="arena-wallet glass-panel arena-wallet--button" onClick={() => setWalletOpen(true)}>
          <span className="arena-wallet__label">Wallet</span>
          <span className="arena-wallet__value">🪙 {user.walletBalance.toLocaleString()}</span>
          <span className="arena-wallet__cta">Top up · History →</span>
        </button>
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
        <p className="arena-fineprint">
          Rooms are 4 players. Top 2 scores win the pool — 🥇 1st gets{' '}
          <strong>🪙 {selectedSplit.first.toLocaleString()}</strong>, 🥈 2nd gets{' '}
          <strong>🪙 {selectedSplit.second.toLocaleString()}</strong>. The bottom 2 win nothing.
        </p>
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
        <ul className="arena-room-grid">
          {rooms.map((room) => {
            const fullPool = room.entryFee * room.maxPlayers;
            const split = splitWinnerPayout(winnerShareOf(fullPool));
            const joinable = room.status === 'waiting' && user.walletBalance >= room.entryFee;
            return (
              <motion.li
                key={room.id}
                className="arena-room-card glass-panel"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <div className="arena-room-card__top">
                  <span className={`arena-room-card__status arena-room-card__status--${room.status}`}>
                    {room.status}
                  </span>
                  <span className="arena-room-card__players">
                    {room.playerCount}/{room.maxPlayers} players
                  </span>
                </div>

                <div className="arena-room-card__stat arena-room-card__stat--fee">
                  <span className="arena-room-card__stat-label">Entry fee</span>
                  <span className="arena-room-card__stat-value">🪙 {room.entryFee.toLocaleString()}</span>
                </div>

                <div className="arena-room-card__stats">
                  <div className="arena-room-card__stat arena-room-card__stat--win">
                    <span className="arena-room-card__stat-label">🥇 1st place</span>
                    <span className="arena-room-card__stat-value arena-room-card__stat-value--win">
                      🪙 {split.first.toLocaleString()}
                    </span>
                  </div>
                  <div className="arena-room-card__stat arena-room-card__stat--win2">
                    <span className="arena-room-card__stat-label">🥈 2nd place</span>
                    <span className="arena-room-card__stat-value arena-room-card__stat-value--win">
                      🪙 {split.second.toLocaleString()}
                    </span>
                  </div>
                </div>
                <p className="arena-room-card__note">Top 2 scores win · bottom 2 win nothing</p>

                <Button variant="secondary" size="md" disabled={!joinable} onClick={() => onJoinRoom(room.id)}>
                  {room.status !== 'waiting' ? 'In progress' : 'Join'}
                </Button>
              </motion.li>
            );
          })}
        </ul>
      </section>

      <WalletModal open={walletOpen} user={user} busy={false} onTopUp={onTopUp} onClose={() => setWalletOpen(false)} />
    </div>
  );
}
