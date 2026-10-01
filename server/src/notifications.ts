/**
 * Player notification center — real events only. Every notification created here
 * corresponds to something that actually just happened server-side (a wallet credit/debit
 * that really posted, a lobby that really filled up, a match result that's really final).
 * There is no synthetic/demo notification generator anywhere in this file.
 */
import { nanoid } from 'nanoid';
import { appendNotification, listNotificationsForUser, markAllNotificationsRead, markNotificationRead } from './store.js';
import type { NotificationEntry, NotificationType } from './types.js';

export function pushNotification(userId: string, type: NotificationType, title: string, body: string, meta?: Record<string, unknown>): NotificationEntry {
  const entry: NotificationEntry = {
    id: nanoid(12),
    userId,
    type,
    title: title.slice(0, 120),
    body: body.slice(0, 500),
    createdAt: Date.now(),
    read: false,
    meta,
  };
  appendNotification(entry);
  return entry;
}

export interface PaginatedNotifications {
  items: NotificationEntry[];
  total: number;
  unreadCount: number;
  page: number;
  pageSize: number;
}

export function listNotifications(userId: string, page = 1, pageSize = 20): PaginatedNotifications {
  const all = listNotificationsForUser(userId)
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt);
  const unreadCount = all.filter((n) => !n.read).length;
  const safePage = Math.max(1, page);
  const safePageSize = Math.min(100, Math.max(1, pageSize));
  const start = (safePage - 1) * safePageSize;
  return { items: all.slice(start, start + safePageSize), total: all.length, unreadCount, page: safePage, pageSize: safePageSize };
}

export function unreadNotificationCount(userId: string): number {
  return listNotificationsForUser(userId).filter((n) => !n.read).length;
}

export function markNotificationAsRead(userId: string, id: string): NotificationEntry | null {
  return markNotificationRead(userId, id);
}

export function markAllAsRead(userId: string): number {
  return markAllNotificationsRead(userId);
}
