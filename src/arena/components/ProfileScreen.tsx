import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { coinWalletId, initialsOf, type ArenaUser, type PlayerStats } from '../types';
import { fetchPlayerStats } from '../api';

interface ProfileScreenProps {
  user: ArenaUser;
  onOpenWallet: () => void;
  onOpenStats: () => void;
  onOpenAchievements: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  onOpenSupport: () => void;
  onLogout: () => Promise<void> | void;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

/** Player profile: identity + wallet shortcut + a compact real stats preview, with links
 *  out to the full Stats, Achievements, History, Settings, and Support screens (all reached
 *  through the persistent nav shell everywhere else in the app too). */
export function ProfileScreen({ user, onOpenWallet, onOpenStats, onOpenAchievements, onOpenHistory, onOpenSettings, onOpenSupport, onLogout }: ProfileScreenProps) {
  const [stats, setStats] = useState<PlayerStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPlayerStats()
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch(() => {
        // Non-critical preview — the full Stats screen will surface a real error if this keeps failing.
      });
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  const winRate = stats && stats.gamesPlayed > 0 ? Math.round(stats.winRate * 100) : null;

  return (
    <div className="profile-screen no-select">
      <header className="screen-header">
        <h1 className="arena-title arena-title--sm">Profile</h1>
      </header>

      <motion.section className="profile-card glass-panel" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
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
          <button type="button" className="dash-section__link" onClick={onOpenWallet}>
            Open Wallet →
          </button>
        </div>
      </motion.section>

      <section className="profile-quick-stats">
        <div className="profile-stat glass-panel">
          <span className="profile-stat__label">Matches</span>
          <span className="profile-stat__value">{stats ? stats.gamesPlayed.toLocaleString() : '—'}</span>
        </div>
        <div className="profile-stat glass-panel">
          <span className="profile-stat__label">Win rate</span>
          <span className="profile-stat__value">{winRate === null ? '—' : `${winRate}%`}</span>
        </div>
        <div className="profile-stat glass-panel">
          <span className="profile-stat__label">Best streak</span>
          <span className="profile-stat__value">{stats ? stats.highestStreak.toLocaleString() : '—'}</span>
        </div>
      </section>

      <nav className="profile-links" aria-label="Profile sections">
        <ProfileLink icon="📊" label="Full Stats" onClick={onOpenStats} />
        <ProfileLink icon="🏆" label="Achievements" onClick={onOpenAchievements} />
        <ProfileLink icon="📜" label="Match History" onClick={onOpenHistory} />
        <ProfileLink icon="⚙️" label="Settings" onClick={onOpenSettings} />
        <ProfileLink icon="🆘" label="Help & Support" onClick={onOpenSupport} />
      </nav>

      <button type="button" className="profile-logout-link" onClick={() => void onLogout()}>
        Log Out
      </button>
    </div>
  );
}

function ProfileLink({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button type="button" className="profile-link glass-panel" onClick={onClick}>
      <span className="profile-link__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="profile-link__label">{label}</span>
      <span className="profile-link__chevron" aria-hidden="true">
        →
      </span>
    </button>
  );
}
