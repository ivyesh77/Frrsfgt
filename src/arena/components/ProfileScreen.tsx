import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from '../../components/common/Button';
import { fetchWalletStats } from '../api';
import { WalletModal } from './WalletModal';
import { coinWalletId, initialsOf, type ArenaUser, type WalletStats } from '../types';

interface ProfileScreenProps {
  user: ArenaUser;
  onBack: () => void;
  onLogout: () => Promise<void> | void;
  onTopUp: (amount: number) => Promise<void> | void;
  onWithdraw: (amount: number) => Promise<void> | void;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

/** Player profile: identity, ArenaCoin wallet shortcut, and lifetime stats (matches
 *  played, win rate, total wagered/won, net profit) computed from the full ledger. */
export function ProfileScreen({ user, onBack, onLogout, onTopUp, onWithdraw }: ProfileScreenProps) {
  const [stats, setStats] = useState<WalletStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [walletOpen, setWalletOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Intentional: this effect synchronizes with the external wallet-stats API each time the
    // user id changes or the balance changes after a deposit/withdrawal — the loading/error
    // flags reset per-fetch.
    // eslint-disable-next-line react/set-state-in-effect
    setLoading(true);
    setLoadError(null);
    fetchWalletStats()
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Could not load profile stats');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user.id, user.walletBalance]);

  const winRate = stats && stats.matchesPlayed > 0 ? Math.round((stats.wins / stats.matchesPlayed) * 100) : null;

  return (
    <div className="arena-lobby profile-screen no-select">
      <header className="arena-lobby__header">
        <div>
          <button type="button" className="profile-back" onClick={onBack}>
            ← Back to Lobby
          </button>
          <h1 className="arena-title arena-title--sm">Profile</h1>
        </div>
        <Button variant="danger" size="md" onClick={() => void onLogout()}>
          Log Out
        </Button>
      </header>

      <motion.section
        className="profile-card glass-panel"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div className="profile-avatar" aria-hidden="true">
          {initialsOf(user.name)}
        </div>
        <div className="profile-identity">
          <h2 className="profile-identity__name">{user.name}</h2>
          <span className="profile-identity__coin-id">{coinWalletId(user.id)}</span>
          <span className="profile-identity__member-since">Member since {formatDate(user.createdAt)}</span>
        </div>
        <div className="profile-balance">
          <span className="profile-balance__label">Wallet balance</span>
          <span className="profile-balance__value">🪙 {user.walletBalance.toLocaleString()} ARC</span>
          <Button variant="secondary" size="md" onClick={() => setWalletOpen(true)}>
            Deposit / Withdraw
          </Button>
        </div>
      </motion.section>

      <section className="arena-section">
        <h2 className="arena-section__title">Lifetime stats</h2>

        {loading && <p className="arena-empty">Loading stats…</p>}
        {loadError && <p className="arena-fineprint arena-fineprint--warn">{loadError}</p>}

        {stats && !loading && !loadError && (
          <div className="profile-stats-grid">
            <div className="profile-stat glass-panel">
              <span className="profile-stat__label">Matches played</span>
              <span className="profile-stat__value">{stats.matchesPlayed.toLocaleString()}</span>
            </div>
            <div className="profile-stat glass-panel">
              <span className="profile-stat__label">Wins</span>
              <span className="profile-stat__value">{stats.wins.toLocaleString()}</span>
            </div>
            <div className="profile-stat glass-panel">
              <span className="profile-stat__label">Win rate</span>
              <span className="profile-stat__value">{winRate === null ? '—' : `${winRate}%`}</span>
            </div>
            <div className="profile-stat glass-panel">
              <span className="profile-stat__label">Total wagered</span>
              <span className="profile-stat__value">🪙 {stats.totalWagered.toLocaleString()}</span>
            </div>
            <div className="profile-stat glass-panel">
              <span className="profile-stat__label">Total won</span>
              <span className="profile-stat__value">🪙 {stats.totalWon.toLocaleString()}</span>
            </div>
            <div className="profile-stat glass-panel">
              <span className="profile-stat__label">Net profit / loss</span>
              <span
                className={`profile-stat__value ${
                  stats.netGameProfit > 0 ? 'profile-stat__value--positive' : stats.netGameProfit < 0 ? 'profile-stat__value--negative' : ''
                }`}
              >
                {stats.netGameProfit > 0 ? '+' : ''}🪙 {stats.netGameProfit.toLocaleString()}
              </span>
            </div>
            <div className="profile-stat glass-panel">
              <span className="profile-stat__label">Total deposited</span>
              <span className="profile-stat__value">🪙 {stats.totalDeposited.toLocaleString()}</span>
            </div>
            <div className="profile-stat glass-panel">
              <span className="profile-stat__label">Total withdrawn</span>
              <span className="profile-stat__value">🪙 {stats.totalWithdrawn.toLocaleString()}</span>
            </div>
          </div>
        )}
      </section>

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
