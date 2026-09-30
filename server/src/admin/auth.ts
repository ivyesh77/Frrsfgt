/**
 * Admin authentication — deliberately a completely separate identity/session system from
 * the player-facing one in ../auth.ts. An admin account is never a row in the player user
 * store; a player account can never log into the admin panel; and an admin session token
 * is checked against a completely different in-memory session map with its own cookie
 * name, so nothing here can ever be satisfied by a player's session cookie or vice versa.
 *
 * Password hashing reuses the exact same scrypt implementation as the player system (no
 * second, weaker hashing scheme invented for "just the admin panel") — see ../auth.ts.
 */
import { randomBytes } from 'node:crypto';
import { nanoid } from 'nanoid';
import { hashPassword, normalizeUsername, verifyPassword } from '../auth.js';
import { checkRateLimit } from '../rateLimit.js';
import type { AdminAccount, AdminRole, PublicAdminAccount } from './types.js';
import { appendLoginAttempt, findAdminByUsernameKey, listAdmins, listLoginAttempts, upsertAdmin } from './store.js';

export class AdminInvalidCredentialsError extends Error {
  constructor() {
    super('Invalid admin username or password');
  }
}
export class AdminAccountDisabledError extends Error {
  constructor() {
    super('This admin account has been deactivated');
  }
}
export class AdminRateLimitedError extends Error {
  constructor() {
    super('Too many admin login attempts — please wait and try again');
  }
}

const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h — shorter-lived than a player session by design

interface AdminSession {
  adminId: string;
  expiresAt: number;
}
const adminSessions = new Map<string, AdminSession>();

export function toPublicAdmin(admin: AdminAccount): PublicAdminAccount {
  return { id: admin.id, name: admin.name, role: admin.role, active: admin.active, createdAt: admin.createdAt, lastLoginAt: admin.lastLoginAt };
}

/** Creates the very first SUPER_ADMIN account on boot if (and only if) no admin account
 *  exists yet AND both ADMIN_BOOTSTRAP_NAME/ADMIN_BOOTSTRAP_PASSWORD env vars are set —
 *  there is deliberately no in-app "sign up as admin" flow (unlike the player app): admin
 *  accounts can only ever be created by an existing SUPER_ADMIN (see users.ts), and this
 *  bootstrap path exists solely to create that very first one from server-side
 *  configuration, never from anything a browser sends. */
export async function bootstrapSuperAdminIfNeeded(): Promise<void> {
  if (listAdmins().length > 0) return;
  const name = process.env.ADMIN_BOOTSTRAP_NAME;
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (!name || !password) {
    // eslint-disable-next-line no-console
    console.warn(
      '[admin] No admin accounts exist yet and ADMIN_BOOTSTRAP_NAME/ADMIN_BOOTSTRAP_PASSWORD are not set — ' +
        'the admin panel has no way to log in until an admin account is created. Set both env vars and restart once.',
    );
    return;
  }
  if (password.length < 12) {
    // eslint-disable-next-line no-console
    console.warn('[admin] ADMIN_BOOTSTRAP_PASSWORD is shorter than 12 characters — refusing to bootstrap an admin with a weak password.');
    return;
  }
  const passwordHash = await hashPassword(password);
  const admin: AdminAccount = {
    id: nanoid(12),
    usernameKey: normalizeUsername(name),
    name: name.trim().slice(0, 40) || 'Super Admin',
    passwordHash,
    role: 'SUPER_ADMIN',
    active: true,
    createdAt: Date.now(),
    createdBy: null,
    lastLoginAt: null,
  };
  upsertAdmin(admin);
  // eslint-disable-next-line no-console
  console.log(`[admin] Bootstrapped the first SUPER_ADMIN account: ${admin.name}`);
}

export async function authenticateAdmin(name: string, password: string, ip: string): Promise<AdminAccount> {
  if (checkRateLimit(`admin-login:${ip}`, 10, 15 * 60 * 1000) === false) {
    throw new AdminRateLimitedError();
  }
  const usernameKey = normalizeUsername(name);
  const admin = findAdminByUsernameKey(usernameKey);
  if (!admin) {
    await hashPassword(password); // constant-time-ish: still pay the hashing cost for a nonexistent username
    appendLoginAttempt({ id: nanoid(10), actor: 'admin', usernameAttempted: name, success: false, timestamp: Date.now(), ip });
    throw new AdminInvalidCredentialsError();
  }
  const ok = await verifyPassword(password, admin.passwordHash);
  if (!ok) {
    appendLoginAttempt({ id: nanoid(10), actor: 'admin', usernameAttempted: name, success: false, timestamp: Date.now(), ip });
    throw new AdminInvalidCredentialsError();
  }
  if (!admin.active) {
    appendLoginAttempt({ id: nanoid(10), actor: 'admin', usernameAttempted: name, success: false, timestamp: Date.now(), ip });
    throw new AdminAccountDisabledError();
  }
  appendLoginAttempt({ id: nanoid(10), actor: 'admin', usernameAttempted: name, success: true, timestamp: Date.now(), ip });
  const updated: AdminAccount = { ...admin, lastLoginAt: Date.now() };
  upsertAdmin(updated);
  return updated;
}

export function createAdminSession(adminId: string): { token: string; expiresAt: number } {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + ADMIN_SESSION_TTL_MS;
  adminSessions.set(token, { adminId, expiresAt });
  return { token, expiresAt };
}

export function resolveAdminSession(token: string | undefined | null): string | null {
  if (!token) return null;
  const session = adminSessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    adminSessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + ADMIN_SESSION_TTL_MS; // idle-timeout semantics, same as player sessions
  return session.adminId;
}

export function destroyAdminSession(token: string | undefined | null): void {
  if (!token) return;
  adminSessions.delete(token);
}

/** Self-service password rotation for the currently authenticated admin only — requires
 *  re-proving the current password (never trusts a bare "I am this admin" claim from the
 *  session alone for a credential change). By design there is no "reset someone else's
 *  admin password" endpoint: a SUPER_ADMIN can deactivate another admin's account (forcing
 *  them to be recreated), but can never silently take over or reset another admin's
 *  password without their cooperation. */
export async function changeOwnAdminPassword(adminId: string, currentPassword: string, newPassword: string): Promise<AdminAccount> {
  const admin = listAdmins().find((a) => a.id === adminId);
  if (!admin) throw new AdminInvalidCredentialsError();
  const ok = await verifyPassword(currentPassword, admin.passwordHash);
  if (!ok) throw new AdminInvalidCredentialsError();
  if (newPassword.length < 12) throw new Error('New password must be at least 12 characters');
  const passwordHash = await hashPassword(newPassword);
  const updated: AdminAccount = { ...admin, passwordHash };
  upsertAdmin(updated);
  return updated;
}

export function destroyAllSessionsForAdmin(adminId: string): number {
  let count = 0;
  for (const [token, session] of adminSessions) {
    if (session.adminId === adminId) {
      adminSessions.delete(token);
      count += 1;
    }
  }
  return count;
}

export function recentFailedAdminLogins(withinMs = 60 * 60 * 1000): number {
  const cutoff = Date.now() - withinMs;
  return listLoginAttempts().filter((a) => a.actor === 'admin' && !a.success && a.timestamp >= cutoff).length;
}

export type { AdminRole };
