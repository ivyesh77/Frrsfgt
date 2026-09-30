import { useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from '../../components/common/Button';
import { WalletModal } from './WalletModal';
import {
  GAME_KIND_TAGLINES,
  ENTRY_FEE_TIERS,
  ROOM_FORMATS,
  winnerShareOf,
  splitWinnerPayout,
  type ArenaUser,
  initialsOf,
  type RoomFormat,
  type RoomFormatMeta,
  type RoomSummary,
} from '../types';
import gameThumbnail from '../../assets/images/memory-match-thumbnail.webp';

interface LobbyProps {
  user: ArenaUser;
  rooms: RoomSummary[];
  busy: boolean;
  onPlay: (entryFee: number, format: RoomFormat) => void;
  onTopUp: (amount: number) => Promise<void> | void;
  onWithdraw: (amount: number) => Promise<void> | void;
  onProfile: () => void;
}

type FormatFilter = 'all' | RoomFormat;

/** Casino-style lobby: pick a stake, hit Play — you're auto-seated at an open table for
 *  that stake, or a fresh one opens for you. No separate "create room" step, and every
 *  stake is always visible as its own table card (never an empty list). */
export function Lobby({ user, rooms, busy, onPlay, onTopUp, onWithdraw, onProfile }: LobbyProps) {
  const [walletOpen, setWalletOpen] = useState(false);
  const [filter, setFilter] = useState<FormatFilter>('all');

  const visibleFormats = ROOM_FORMATS.filter((f) => filter === 'all' || f.id === filter);

  return (
    <div className="arena-lobby no-select">
      <header className="arena-lobby__header">
        <div>
          <h1 className="arena-title arena-title--sm">Wager Arena</h1>
          <p className="arena-subtitle arena-subtitle--sm">Hi {user.name}, pick a table and play.</p>
        </div>
        <div className="arena-lobby__header-actions">
          <button type="button" className="arena-profile-button" onClick={onProfile} aria-label="Open profile">
            <span className="arena-profile-button__avatar" aria-hidden="true">
              {initialsOf(user.name)}
            </span>
            Profile
          </button>
          <button type="button" className="arena-wallet glass-panel arena-wallet--button" onClick={() => setWalletOpen(true)}>
            <span className="arena-wallet__label">Wallet</span>
            <span className="arena-wallet__value">🪙 {user.walletBalance.toLocaleString()}</span>
            <span className="arena-wallet__cta">Deposit · Withdraw · History →</span>
          </button>
        </div>
      </header>

      <section className="arena-game-feature glass-panel">
        <img className="arena-game-feature__art" src={gameThumbnail} alt="Memory Match" />
        <div className="arena-game-feature__body">
          <h2 className="arena-game-feature__title">🧠 Memory Match</h2>
          <p className="arena-game-feature__tagline">{GAME_KIND_TAGLINES.memoryMatch}</p>
        </div>
      </section>

      <div className="arena-format-filter" role="tablist" aria-label="Filter tables by format">
        <button
          type="button"
          role="tab"
          aria-selected={filter === 'all'}
          className={`arena-chip arena-format-filter__chip ${filter === 'all' ? 'arena-chip--active' : ''}`}
          onClick={() => setFilter('all')}
        >
          All tables
        </button>
        {ROOM_FORMATS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            className={`arena-chip arena-format-filter__chip ${filter === f.id ? 'arena-chip--active' : ''}`}
            onClick={() => setFilter(f.id)}
          >
            {f.icon} {f.label}
          </button>
        ))}
      </div>

      {visibleFormats.map((format) => (
        <FormatSection
          key={format.id}
          format={format}
          rooms={rooms}
          user={user}
          busy={busy}
          onPlay={onPlay}
        />
      ))}

      <WalletModal
        open={walletOpen}
        user={user}
        busy={false}
        onTopUp={onTopUp}
        onWithdraw={onWithdraw}
        onClose={() => setWalletOpen(false)}
      />
    </div>
  );
}


interface FormatSectionProps {
  format: RoomFormatMeta;
  rooms: RoomSummary[];
  user: ArenaUser;
  busy: boolean;
  onPlay: (entryFee: number, format: RoomFormat) => void;
}

/** One casino "game mode" section — a fixed row of stake-tier tables, all sharing the
 *  same format (1v1 duel or 4-player squad), each always visible regardless of whether
 *  anyone has opened a table for that stake yet. */
function FormatSection({ format, rooms, user, busy, onPlay }: FormatSectionProps) {
  return (
    <section className="arena-section">
      <h2 className="arena-section__title">
        {format.icon} {format.label}
      </h2>
      <p className="arena-section__lede">
        Memory Match · {format.players} players · {format.tagline}
      </p>

      <ul className="arena-table-grid">
        {ENTRY_FEE_TIERS.map((fee) => {
          // Purely cosmetic — "how full does a queue for this stake currently look". The
          // player never picks or targets this specific room: clicking Play always asks the
          // server's own matchmaking queue to place them, which may seat them here, on a
          // different still-filling queue, or on a brand new one — the server decides.
          const openTable = rooms.find(
            (r) => r.entryFee === fee && r.format === format.id && r.status === 'queued' && r.playerCount < r.maxPlayers,
          );
          const liveTablesCount = rooms.filter(
            (r) => r.entryFee === fee && r.format === format.id && r.status !== 'queued',
          ).length;
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
                  <span className="arena-table-card__game">Memory Match · {format.label}</span>
                  <span className="arena-table-card__seats">
                    {seated}/{format.players} seated{liveTablesCount > 0 ? ` · ${liveTablesCount} table(s) live` : ''}
                  </span>
                </div>
              </div>

              <div className="arena-table-card__entry">
                <span className="arena-table-card__entry-label">Entry fee</span>
                <span className="arena-table-card__entry-value">🪙 {fee.toLocaleString()}</span>
              </div>

              <PrizeBreakdown format={format} entryFee={fee} />

              <Button
                variant="primary"
                size="md"
                className="arena-table-card__play"
                disabled={!affordable || busy}
                onClick={() => onPlay(fee, format.id)}
              >
                {seated > 0 ? `Join matchmaking (${seated}/${format.players})` : 'Find Match'}
              </Button>
              {!affordable && <p className="arena-fineprint arena-fineprint--warn">Deposit more ArenaCoin to play this table.</p>}
            </motion.li>
          );
        })}
      </ul>
    </section>
  );
}

/** Renders the prize row(s) for a table card: a single "winner takes all" row for a
 *  duel, or a 🥇/🥈 split row pair for a squad match. */
function PrizeBreakdown({ format, entryFee }: { format: RoomFormatMeta; entryFee: number }) {
  const pool = entryFee * format.players;
  const winnerPool = winnerShareOf(pool);

  if (format.winnerCount === 1) {
    return (
      <div className="arena-table-card__prizes">
        <div className="arena-table-card__prize arena-table-card__prize--gold">
          <span className="arena-table-card__prize-medal" aria-hidden="true">
            🏆
          </span>
          <span className="arena-table-card__prize-label">Winner takes all</span>
          <span className="arena-table-card__prize-value">🪙 {winnerPool.toLocaleString()}</span>
        </div>
      </div>
    );
  }

  const split = splitWinnerPayout(winnerPool);
  return (
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
  );
}
