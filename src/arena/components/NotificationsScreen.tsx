import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from '../../components/common/Button';
import { fetchNotifications, markAllNotificationsRead, markNotificationRead } from '../api';
import { NOTIFICATION_ICONS, type NotificationEntry } from '../types';

interface NotificationsScreenProps {
  onBack: () => void;
  /** Lets the parent keep the sidebar/top-bar unread badge in sync the instant something
   *  here is marked read, without a second poll round-trip. */
  onUnreadCountChange: (count: number) => void;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Every entry here corresponds to something that actually happened on this account
 *  server-side (see server/src/notifications.ts) — there is no synthetic/demo notification
 *  generator anywhere in this app. An account with no real events yet sees an honest empty
 *  state instead of sample notifications. */
export function NotificationsScreen({ onBack, onUnreadCountChange }: NotificationsScreenProps) {
  const [items, setItems] = useState<NotificationEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  function load() {
    setError(null);
    fetchNotifications(1, 50)
      .then((res) => {
        setItems(res.items);
        onUnreadCountChange(res.unreadCount);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load notifications'));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function markRead(id: string) {
    const entry = items?.find((n) => n.id === id);
    if (!entry || entry.read) return;
    try {
      await markNotificationRead(id);
      setItems((prev) => prev?.map((n) => (n.id === id ? { ...n, read: true } : n)) ?? prev);
      onUnreadCountChange(Math.max(0, (items?.filter((n) => !n.read).length ?? 1) - 1));
    } catch {
      // Non-critical — the item just stays unread until the next load.
    }
  }

  async function markAll() {
    setMarkingAll(true);
    try {
      await markAllNotificationsRead();
      setItems((prev) => prev?.map((n) => ({ ...n, read: true })) ?? prev);
      onUnreadCountChange(0);
    } finally {
      setMarkingAll(false);
    }
  }

  const unreadCount = items?.filter((n) => !n.read).length ?? 0;

  return (
    <div className="notifications-screen no-select">
      <button type="button" className="profile-back" onClick={onBack}>
        ← Back
      </button>
      <header className="screen-header">
        <h1 className="arena-title arena-title--sm">Notifications</h1>
        {unreadCount > 0 && (
          <Button variant="ghost" size="md" disabled={markingAll} onClick={() => void markAll()}>
            Mark all as read
          </Button>
        )}
      </header>

      {error && <p className="arena-fineprint arena-fineprint--warn">{error}</p>}
      {items === null && !error && <p className="arena-empty">Loading…</p>}
      {items !== null && items.length === 0 && <p className="arena-empty">No notifications yet — real match, wallet, and account events will show up here.</p>}

      {items !== null && items.length > 0 && (
        <ul className="notifications-list">
          {items.map((n) => (
            <motion.li
              key={n.id}
              layout
              className={`notification-item glass-panel ${n.read ? '' : 'notification-item--unread'}`}
              onClick={() => void markRead(n.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') void markRead(n.id);
              }}
            >
              <span className="notification-item__icon" aria-hidden="true">
                {NOTIFICATION_ICONS[n.type]}
              </span>
              <span className="notification-item__body">
                <span className="notification-item__title">{n.title}</span>
                <span className="notification-item__text">{n.body}</span>
                <span className="notification-item__time">{formatTime(n.createdAt)}</span>
              </span>
              {!n.read && <span className="notification-item__dot" aria-label="Unread" />}
            </motion.li>
          ))}
        </ul>
      )}
    </div>
  );
}
