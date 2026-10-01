import type { ReactNode } from 'react';
import { initialsOf, type ArenaUser } from '../types';
import { sounds } from '../sound';
import { haptics } from '../haptics';

export type ShellTab = 'home' | 'play' | 'wallet' | 'history' | 'profile';

interface NavItem {
  id: ShellTab;
  label: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'home', label: 'Home', icon: '🏠' },
  { id: 'play', label: 'Play', icon: '🎮' },
  { id: 'wallet', label: 'Wallet', icon: '🪙' },
  { id: 'history', label: 'History', icon: '📜' },
  { id: 'profile', label: 'Profile', icon: '👤' },
];

interface AppShellProps {
  user: ArenaUser;
  activeTab: ShellTab;
  onTabChange: (tab: ShellTab) => void;
  unreadNotifications: number;
  onOpenNotifications: () => void;
  onOpenSettings: () => void;
  offline: boolean;
  children: ReactNode;
}

/**
 * Responsive navigation shell: a left sidebar on desktop/tablet widths, a fixed bottom tab
 * bar on narrow/mobile widths — both rendered from the exact same `NAV_ITEMS`/state so
 * there is only ever one real navigation model, just two CSS layouts for it (see
 * arena.css `.app-shell__sidebar` / `.app-shell__bottom-nav` media queries).
 */
export function AppShell({ user, activeTab, onTabChange, unreadNotifications, onOpenNotifications, onOpenSettings, offline, children }: AppShellProps) {
  function go(tab: ShellTab) {
    if (tab === activeTab) return;
    sounds.click();
    haptics.tap();
    onTabChange(tab);
  }

  return (
    <div className="app-shell">
      <aside className="app-shell__sidebar" aria-label="Primary navigation">
        <div className="app-shell__brand">
          <span aria-hidden="true">🪙</span> Wager Arena
        </div>
        <nav className="app-shell__nav" aria-label="Main">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`app-shell__nav-item ${activeTab === item.id ? 'app-shell__nav-item--active' : ''}`}
              aria-current={activeTab === item.id ? 'page' : undefined}
              onClick={() => go(item.id)}
            >
              <span className="app-shell__nav-icon" aria-hidden="true">
                {item.icon}
              </span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="app-shell__sidebar-footer">
          <button type="button" className="app-shell__icon-btn" onClick={onOpenNotifications} aria-label={`Notifications${unreadNotifications > 0 ? `, ${unreadNotifications} unread` : ''}`}>
            🔔 Notifications
            {unreadNotifications > 0 && <span className="app-shell__badge">{unreadNotifications > 99 ? '99+' : unreadNotifications}</span>}
          </button>
          <button type="button" className="app-shell__icon-btn" onClick={onOpenSettings} aria-label="Settings">
            ⚙️ Settings
          </button>
        </div>
      </aside>

      <div className="app-shell__main">
        <header className="app-shell__topbar">
          <div className="app-shell__topbar-brand">
            <span aria-hidden="true">🪙</span> Wager Arena
          </div>
          <div className="app-shell__topbar-actions">
            <span className="app-shell__topbar-balance" aria-label="Wallet balance">
              🪙 {user.walletBalance.toLocaleString()}
            </span>
            <button type="button" className="app-shell__icon-btn app-shell__icon-btn--round" onClick={onOpenNotifications} aria-label={`Notifications${unreadNotifications > 0 ? `, ${unreadNotifications} unread` : ''}`}>
              🔔
              {unreadNotifications > 0 && <span className="app-shell__badge app-shell__badge--dot" aria-hidden="true" />}
            </button>
            <button type="button" className="app-shell__icon-btn app-shell__icon-btn--round" onClick={onOpenSettings} aria-label="Settings">
              ⚙️
            </button>
            <span className="app-shell__avatar" aria-hidden="true">
              {initialsOf(user.name)}
            </span>
          </div>
        </header>

        {offline && (
          <div className="app-shell__offline-banner" role="status">
            ⚠️ You&rsquo;re offline — live matches and wallet actions need a connection. Reconnecting automatically…
          </div>
        )}

        <main className="app-shell__content">{children}</main>
      </div>

      <nav className="app-shell__bottom-nav" aria-label="Primary navigation">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`app-shell__bottom-item ${activeTab === item.id ? 'app-shell__bottom-item--active' : ''}`}
            aria-current={activeTab === item.id ? 'page' : undefined}
            onClick={() => go(item.id)}
          >
            <span className="app-shell__bottom-icon" aria-hidden="true">
              {item.icon}
            </span>
            <span className="app-shell__bottom-label">{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
