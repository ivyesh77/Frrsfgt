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
  busy: boolean;
  onPlay: (entryFee: number) => void;
  onTopUp: (amount: number) => Promise<void> | void;
}

/** Casino-style lobby: pick a stake, hit Play — you're auto-seated at an open table for
 *  that stake, or a fresh one opens for you. No separate "create room" step, and every
 *  stake is always visible as its own table card (never an empty list). */
export function Lobby({ user, rooms, busy, onPlay, onTopUp }: LobbyProps) {
  const [walletOpen, setWalletOpen] = useState(false);

  return (
    <div className="arena-lobby no-select">
      <header className="arena-lobby__header">
        <div>
          <h1 className="arena-title arena-title--sm">Wager Arena</h1>
          <p className="arena-subtitle arena-subtitle--sm">Hi {user.name}, pick a table and play.</p>
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
        <h2 className="arena-section__title">Choose your table</h2>
        <p className="arena-section__lede">
          Every table is Memory Match, 4 players. Top 2 scores win the pool, bottom 2 win nothing.
        </p>

        <ul className="arena-table-grid">
          {ENTRY_FEE_TIERS.map((fee) => {
            const split = splitWinnerPayout(winnerShareOf(fee * MAX_PLAYERS_PER_ROOM));
            const openTable = rooms.find((r) => r.entryFee === fee && r.status === 'waiting' && r.playerCount < r.maxPlayers);
            const liveTablesCount = rooms.filter((r) => r.entryFee === fee && r.status !== 'waiting' && r.status !== 'finished').length;
            const seated = openTable?.playerCount ?? 0;
            const affordable = user.walletBalance >= fee;

            return (
              <motion.li
                key={fee}
                className="arena-table-card glass-panel"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <div className="arena-table-card__top">
                  <img className="arena-table-card__icon" src={gameThumbnail} alt="" aria-hidden="true" />
                  <div className="arena-table-card__heading">
                    <span className="arena-table-card__game">Memory Match</span>
                    <span className="arena-table-card__seats">
                      {seated}/{MAX_PLAYERS_PER_ROOM} seated{liveTablesCount > 0 ? ` · ${liveTablesCount} table(s) live` : ''}
                    </span>
                  </div>
                </div>

                <div className="arena-table-card__entry">
                  <span className="arena-table-card__entry-label">Entry fee</span>
                  <span className="arena-table-card__entry-value">🪙 {fee.toLocaleString()}</span>
                </div>

                <div className="arena-table-card__prizes">
                  <div className="arena-table-card__prize arena-table-card__prize--gold">
                    <span className="arena-table-card__prize-medal" aria-hidden="true">
                      🥇
                    </span>
                    <span className="arena-table-card__prize-label">1st place</span>
                    <span className="arena-table-card__prize-value">🪙 {split.first.toLocaleString()}</span>
                  </div>
                  <div className="arena-table-card__prize arena-table-card__prize--silver">
                    <span className="arena-table-card__prize-medal" aria-hidden="true">
                      🥈
                    </span>
                    <span className="arena-table-card__prize-label">2nd place</span>
                    <span className="arena-table-card__prize-value">🪙 {split.second.toLocaleString()}</span>
                  </div>
                </div>

                <Button variant="primary" size="md" className="arena-table-card__play" disabled={!affordable || busy} onClick={() => onPlay(fee)}>
                  {seated > 0 ? `Join table (${seated}/${MAX_PLAYERS_PER_ROOM})` : 'Play'}
                </Button>
                {!affordable && <p className="arena-fineprint arena-fineprint--warn">Top up your wallet to play this table.</p>}
              </motion.li>
            );
          })}
        </ul>
      </section>

      <WalletModal open={walletOpen} user={user} busy={false} onTopUp={onTopUp} onClose={() => setWalletOpen(false)} />
    </div>
  );
}
