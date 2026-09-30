/**
 * Admin user management: server-side paginated listing/search, a full detail projection,
 * and the small set of authorized moderation actions. Every mutation here is applied to
 * the SAME player User record the player-facing app reads (../store.ts) — there is no
 * separate, divergent "admin view" of who a user is, only a different, permission-gated
 * set of operations allowed to touch it.
 */
import { destroyAllSessionsForUser, countActiveSessionsForUser } from '../auth.js';
import { getTransactionsForUser, getUser, listAllUsersRaw, upsertUser } from '../store.js';
import { toPublicUser } from '../wallet.js';
import type { AccountStatus, PublicUser, User } from '../types.js';
import { matchHistoryForUser } from './matchHistory.js';
import { notesForUser } from './support.js';
import { countEvent } from './signals.js';

export interface AdminUserRow {
  id: string;
  name: string;
  status: AccountStatus;
  createdAt: number;
  walletBalance: number;
  matchesPlayed: number;
  online: boolean;
}

export type UserFilter = 'all' | 'active' | 'suspended' | 'banned' | 'online' | 'offline';

export interface ListUsersParams {
  page: number;
  pageSize: number;
  search?: string;
  filter?: UserFilter;
}

export interface ListUsersResult {
  rows: AdminUserRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** `isOnline` is supplied by the caller (server.ts, which has access to the live
 *  Socket.IO connection set) rather than computed here, so this module never needs to
 *  reach into the realtime layer directly. */
export function listUsers(params: ListUsersParams, isOnline: (userId: string) => boolean): ListUsersResult {
  const search = params.search?.trim().toLowerCase();
  let all = listAllUsersRaw();

  if (search) {
    all = all.filter((u) => u.id.toLowerCase().includes(search) || u.name.toLowerCase().includes(search));
  }
  if (params.filter && params.filter !== 'all') {
    all = all.filter((u) => {
      switch (params.filter) {
        case 'active':
          return u.status === 'active';
        case 'suspended':
          return u.status === 'suspended';
        case 'banned':
          return u.status === 'banned';
        case 'online':
          return isOnline(u.id);
        case 'offline':
          return !isOnline(u.id);
        default:
          return true;
      }
    });
  }

  const total = all.length;
  const sorted = all.slice().sort((a, b) => b.createdAt - a.createdAt);
  const pageSize = Math.min(Math.max(params.pageSize, 1), 100); // hard server-side cap — never trust a client-requested page size to load an unbounded dataset
  const page = Math.max(params.page, 1);
  const start = (page - 1) * pageSize;
  const pageRows = sorted.slice(start, start + pageSize);

  const rows: AdminUserRow[] = pageRows.map((u) => ({
    id: u.id,
    name: u.name,
    status: u.status,
    createdAt: u.createdAt,
    walletBalance: u.walletBalance,
    matchesPlayed: matchHistoryForUser(u.id).length,
    online: isOnline(u.id),
  }));

  return { rows, total, page, pageSize };
}

export interface AdminUserDetail {
  id: string;
  name: string;
  status: AccountStatus;
  createdAt: number;
  walletBalance: number;
  activeSessionCount: number;
  online: boolean;
  matchHistory: ReturnType<typeof matchHistoryForUser>;
  transactions: ReturnType<typeof getTransactionsForUser>;
  supportNotes: ReturnType<typeof notesForUser>;
  recentAnswerRatePerMinute: number;
}

export function getUserDetail(userId: string, isOnline: (userId: string) => boolean): AdminUserDetail | null {
  const user = getUser(userId);
  if (!user) return null;
  const sessionInfo = countActiveSessionsForUser(userId);
  return {
    id: user.id,
    name: user.name,
    status: user.status,
    createdAt: user.createdAt,
    walletBalance: user.walletBalance,
    activeSessionCount: sessionInfo.count,
    online: isOnline(userId),
    matchHistory: matchHistoryForUser(userId),
    transactions: getTransactionsForUser(userId, 200),
    supportNotes: notesForUser(userId),
    recentAnswerRatePerMinute: countEvent('answerSubmitted', userId, 60_000),
  };
}

export class UserNotFoundError extends Error {
  constructor() {
    super('User not found');
  }
}

function setStatus(userId: string, status: AccountStatus): User {
  const user = getUser(userId);
  if (!user) throw new UserNotFoundError();
  const updated: User = { ...user, status };
  upsertUser(updated);
  return updated;
}

// Every function below returns only `toPublicUser(...)` — NEVER the raw `User` record —
// because these results flow straight into both the HTTP response body and the audit
// log's `after` field (see admin/server.ts's moderationAction wrapper). The audited
// "immutable record" must never itself become a place a password hash leaks to; the
// explicit spec requirement ("never show passwords/password hashes") applies just as much
// to an audit trail an admin can read later as it does to the live API response.
export function suspendUser(userId: string): { user: PublicUser; sessionsInvalidated: number } {
  const user = setStatus(userId, 'suspended');
  const sessionsInvalidated = destroyAllSessionsForUser(userId);
  return { user: toPublicUser(user), sessionsInvalidated };
}
export function unsuspendUser(userId: string): { user: PublicUser } {
  return { user: toPublicUser(setStatus(userId, 'active')) };
}
export function banUser(userId: string): { user: PublicUser; sessionsInvalidated: number } {
  const user = setStatus(userId, 'banned');
  const sessionsInvalidated = destroyAllSessionsForUser(userId);
  return { user: toPublicUser(user), sessionsInvalidated };
}
export function unbanUser(userId: string): { user: PublicUser } {
  return { user: toPublicUser(setStatus(userId, 'active')) };
}
export function forceLogoutUser(userId: string): number {
  return destroyAllSessionsForUser(userId);
}
