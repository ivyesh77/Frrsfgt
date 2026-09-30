/** Admin alert/notification center. Real alerts are raised by actual server conditions
 *  (see server.ts's periodic health sampler) — never fabricated for visual effect. */
import { nanoid } from 'nanoid';
import { listNotifications, upsertNotification } from './store.js';
import type { AdminAccount, AdminNotification, NotificationSeverity } from './types.js';

export function raiseNotification(kind: string, message: string, severity: NotificationSeverity): AdminNotification {
  // Avoid flooding the list with duplicates of the same still-open condition.
  const existingOpen = listNotifications().find((n) => n.kind === kind && n.status === 'open');
  if (existingOpen) return existingOpen;
  const notification: AdminNotification = {
    id: nanoid(12),
    severity,
    kind,
    message,
    createdAt: Date.now(),
    status: 'open',
    acknowledgedBy: null,
    resolvedBy: null,
    updatedAt: Date.now(),
  };
  upsertNotification(notification);
  return notification;
}

export function allNotifications(): AdminNotification[] {
  return listNotifications().slice().reverse();
}

export function acknowledgeNotification(id: string, admin: AdminAccount): AdminNotification {
  const notification = listNotifications().find((n) => n.id === id);
  if (!notification) throw new Error('Notification not found');
  const updated: AdminNotification = { ...notification, status: 'acknowledged', acknowledgedBy: admin.id, updatedAt: Date.now() };
  upsertNotification(updated);
  return updated;
}

export function resolveNotification(id: string, admin: AdminAccount): AdminNotification {
  const notification = listNotifications().find((n) => n.id === id);
  if (!notification) throw new Error('Notification not found');
  const updated: AdminNotification = { ...notification, status: 'resolved', resolvedBy: admin.id, updatedAt: Date.now() };
  upsertNotification(updated);
  return updated;
}
