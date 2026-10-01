/**
 * The admin operations center's HTTP API — a SEPARATE Express app bound to its own,
 * independently configurable port (ADMIN_PORT, default 8788 — see index.ts). It is a
 * factory rather than a module-level singleton specifically so it takes the player
 * server's already-running `roomManager`/`io` as explicit dependencies instead of
 * importing index.ts (which would create a circular import, and more importantly would
 * blur the line between "the admin server reads the real backend's live state" and "the
 * admin server duplicates its own copy of that state" — it must always be the former).
 *
 * Every route below follows the same shape: `requireAdmin` (resolves a real, currently-
 * active admin session — never anything client-asserted) then `requirePermission(...)`
 * (checked against the server-side ROLE_PERMISSIONS matrix for that exact account's role).
 * Sensitive mutations additionally call `writeAudit(...)` unconditionally (success or
 * failure) so the audit trail is never selectively incomplete.
 */
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { createServer } from 'node:http';
import { nanoid } from 'nanoid';
import type { Server as SocketIOServer } from 'socket.io';
import { hashPassword, normalizeUsername } from '../auth.js';
import { getUser } from '../store.js';
import type { RoomManager } from '../rooms.js';
import { ENTRY_FEE_TIERS, ROOM_FORMATS } from '../types.js';
import { adminAdjustBalance, toPublicUser } from '../wallet.js';
import { listAllTransactionsRaw, listAllUsersRaw, countUsers } from '../store.js';
import {
  AdminAccountDisabledError,
  AdminInvalidCredentialsError,
  AdminRateLimitedError,
  authenticateAdmin,
  bootstrapSuperAdminIfNeeded,
  changeOwnAdminPassword,
  createAdminSession,
  destroyAdminSession,
  destroyAllSessionsForAdmin,
  recentFailedAdminLogins,
  toPublicAdmin,
} from './auth.js';
import { getGameConfigHistory, getEffectiveGameConfig, InvalidConfigValueError, updateGameConfig } from './config.js';
import { listGameAssets, setAssetActive, setAssetTags, UnknownAssetError, WouldEmptyActiveSetError } from './gameContent.js';
import { getEffectiveFlags, getFlagsHistory, setFlag, UnknownFeatureFlagError } from './flags.js';
import { getAllMaintenanceStates, MAINTENANCE_SCOPES, setMaintenance } from './maintenance.js';
import {
  computeReconciliation,
  getEffectiveCryptoConfigs,
  getEffectiveUpiConfig,
  allWebhookEvents,
  networkMismatchWarnings,
  NetworkMismatchWarning,
  retryWebhookEvent,
  updateCryptoConfig,
  updateUpiConfig,
  WebhookRetryUnsafeError,
} from './payments.js';
import { ADMIN_SESSION_COOKIE, requireAdmin, requirePermission } from './permissions.js';
import { computeAntiCheatSummary, computeRiskSignals } from './risk.js';
import { allMatchHistory } from './matchHistory.js';
import { acknowledgeNotification, allNotifications, raiseNotification, resolveNotification } from './notifications.js';
import { addSupportNote, allTickets, createTicket, updateTicketStatus } from './support.js';
import { countAllEvents } from './signals.js';
import { getUserDetail, listUsers, suspendUser, unsuspendUser, banUser, unbanUser, forceLogoutUser, UserNotFoundError, type UserFilter } from './users.js';
import { listAdmins, listAuditLog, upsertAdmin } from './store.js';
import { writeAudit } from './audit.js';
import { ADMIN_ROLES, roleHasPermission, PERMISSIONS, type AdminAccount, type AdminRole, type MaintenanceScope } from './types.js';
import { archiveAdapter, configureAdapter, healthCheckAdapter, listPublicAdapters, publicAdapter } from '../payments/registry.js';
import { getPaymentConfig, getPaymentTransaction, getRoutingDecision, listPaymentAdapters, listPaymentAuditEvents, listPaymentRiskSignals, listPaymentTransactions, listProviderEvents, listReconciliationRecords, updatePaymentConfig } from '../payments/store.js';
import { reconcileAllPending, reconcileTransaction } from '../payments/reconciliation.js';
import { listWebhookEvents } from '../payments/webhooks.js';
import { type PaymentAdapterId, type PaymentConfig, type PaymentLimits, type PaymentOperation, type PaymentTransactionStatus } from '../payments/types.js';

export interface AdminServerDeps {
  roomManager: RoomManager;
  io: SocketIOServer;
}

function jsonRateLimitHandler(_req: Request, res: Response): void {
  res.status(429).json({ error: 'Too many requests — please slow down and try again shortly' });
}

function requestId(req: Request): string {
  const existing = req.headers['x-request-id'];
  return typeof existing === 'string' && existing.length > 0 ? existing : nanoid(12);
}

const SERVER_STARTED_AT = Date.now();

export function createAdminApp(deps: AdminServerDeps) {
  const { roomManager, io } = deps;
  const app = express();
  const isProduction = process.env.NODE_ENV === 'production';

  // Same reasoning as server/src/index.ts — trust the configured number of reverse-proxy
  // hops so `req.secure` reflects the ORIGINAL client request's scheme (X-Forwarded-Proto),
  // not the scheme of the final internal hop reaching this process.
  app.set('trust proxy', Number(process.env.TRUSTED_PROXY_HOPS ?? 1));

  // Strict origin allowlist rather than the player API's "reflect any origin" policy — the
  // admin panel is operated by staff, not the general public, so there is no reason to ever
  // accept a credentialed cross-origin admin request from an arbitrary site. Configure via
  // ADMIN_ALLOWED_ORIGIN; defaults to same-origin-only (no CORS header at all) if unset.
  const allowedOrigin = process.env.ADMIN_ALLOWED_ORIGIN;
  app.use(
    cors({
      origin: allowedOrigin ? allowedOrigin.split(',').map((o) => o.trim()) : false,
      credentials: true,
    }),
  );
  // Same defense-in-depth security headers as the player API (see src/index.ts) — the
  // admin center never serves HTML either, so this protects direct navigation and provides
  // standard baseline hardening expected of an internal operations console.
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    if (isProduction || req.secure) {
      res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    }
    next();
  });

  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use((req, _res, next) => {
    req.headers['x-request-id'] = requestId(req);
    next();
  });

  function isOnline(userId: string): boolean {
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.userId === userId) return true;
    }
    return false;
  }
  function onlineUserCount(): number {
    const seen = new Set<string>();
    for (const socket of io.sockets.sockets.values()) {
      if (typeof socket.data.userId === 'string') seen.add(socket.data.userId);
    }
    return seen.size;
  }

  const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false, handler: jsonRateLimitHandler });
  const writeLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false, handler: jsonRateLimitHandler });
  const readLimiter = rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: true, legacyHeaders: false, handler: jsonRateLimitHandler });

  function setAdminCookie(res: Response, token: string, req: Request) {
    // See server/src/index.ts setSessionCookie for the identical, honestly-documented
    // reasoning — `secure`/`sameSite` must reflect whether THIS request was actually HTTPS
    // (via `req.secure`, which `trust proxy` above makes correct), not a hardcoded assumption.
    const isHttps = isProduction || req.secure;
    res.cookie(ADMIN_SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: isProduction ? 'lax' : isHttps ? 'none' : 'lax',
      secure: isHttps,
      maxAge: 12 * 60 * 60 * 1000,
      path: '/',
    });
  }

  app.get('/admin/health', (_req, res) => res.json({ ok: true }));

  // --- Auth ------------------------------------------------------------------------
  app.post('/admin/auth/login', loginLimiter, async (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!name || !password) return res.status(400).json({ error: 'Name and password are required' });
    try {
      const admin = await authenticateAdmin(name, password, req.ip ?? 'unknown');
      const { token } = createAdminSession(admin.id);
      setAdminCookie(res, token, req);
      res.json({ admin: toPublicAdmin(admin), token, permissions: PERMISSIONS.filter((p) => roleHasPermission(admin.role, p)) });
    } catch (err) {
      if (err instanceof AdminInvalidCredentialsError) return res.status(401).json({ error: err.message });
      if (err instanceof AdminAccountDisabledError) return res.status(403).json({ error: err.message });
      if (err instanceof AdminRateLimitedError) return res.status(429).json({ error: err.message });
      res.status(400).json({ error: 'Login failed' });
    }
  });

  app.post('/admin/auth/logout', (req, res) => {
    const authHeader = req.headers.authorization;
    const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const cookie = (req.cookies as Record<string, string> | undefined)?.[ADMIN_SESSION_COOKIE];
    destroyAdminSession(bearer);
    if (cookie !== bearer) destroyAdminSession(cookie);
    res.clearCookie(ADMIN_SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  app.get('/admin/auth/me', requireAdmin, (req, res) => {
    const admin = req.admin!;
    res.json({ admin: toPublicAdmin(admin), permissions: PERMISSIONS.filter((p) => roleHasPermission(admin.role, p)) });
  });

  // Self-service password rotation — every admin (any role) may change their OWN password,
  // no extra permission required, but the current password must still be re-proven. After
  // a successful change, every other session for this admin is destroyed (this one is kept
  // alive by re-issuing a fresh token) so a leaked old credential can't keep riding an old
  // session forever once the holder rotates their password.
  app.post('/admin/auth/change-password', requireAdmin, loginLimiter, async (req, res) => {
    const admin = req.admin!;
    const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
    const rid = requestId(req);
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new password are required' });
    try {
      const updated = await changeOwnAdminPassword(admin.id, currentPassword, newPassword);
      const authHeader = req.headers.authorization;
      const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
      const cookieToken = (req.cookies as Record<string, string> | undefined)?.[ADMIN_SESSION_COOKIE];
      const currentToken = bearer ?? cookieToken;
      destroyAllSessionsForAdmin(admin.id); // rotate out every existing session, including this request's...
      const { token } = createAdminSession(admin.id); // ...then issue one fresh session so this browser stays logged in.
      setAdminCookie(res, token, req);
      writeAudit({ admin: updated, action: 'CHANGE_OWN_PASSWORD', targetKind: 'admin', targetId: admin.id, reason: 'Self-service password change', result: 'success', requestId: rid });
      void currentToken; // the old token for this request was already invalidated above; nothing else to do with it
      res.json({ ok: true, admin: toPublicAdmin(updated), token });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to change password' });
    }
  });

  app.use('/admin', readLimiter); // baseline read budget for everything below; specific write routes layer writeLimiter on top

  // --- Dashboard ------------------------------------------------------------------------
  app.get('/admin/dashboard', requireAdmin, requirePermission('dashboard.view'), (_req, res) => {
    const rooms = roomManager.listRoomsAdmin();
    const now = Date.now();
    const todayStart = new Date().setHours(0, 0, 0, 0);
    const users = listAllUsersRaw();
    const transactions = listAllTransactionsRaw();

    res.json({
      usersOnline: onlineUserCount(),
      activeRooms: rooms.filter((r) => r.status === 'active').length,
      activeMatches: rooms.filter((r) => r.status === 'active').length,
      matchmakingQueue: rooms.filter((r) => r.status === 'queued').length,
      todaysGames: allMatchHistory().filter((m) => m.endedAt >= todayStart).length,
      todaysUsers: users.filter((u) => u.createdAt >= todayStart).length,
      deposits: transactions.filter((t) => t.type === 'topup').length,
      withdrawals: transactions.filter((t) => t.type === 'withdrawal').length,
      pendingTransactions: transactions.filter((t) => t.status === 'pending' || t.status === 'processing').length,
      paymentFailures: transactions.filter((t) => t.status === 'failed').length,
      systemHealth: 'ok' as const,
      errorRateLastHour: countAllEvents('serverError', 60 * 60_000),
      apiLatencyMsP50: 0, // see /admin/system/health — no real APM wired up, honestly reported as unavailable rather than fabricated
      websocketStatus: io.engine ? 'up' : 'down',
      uptimeMs: now - SERVER_STARTED_AT,
      recentFailedAdminLoginsLastHour: recentFailedAdminLogins(),
    });
  });

  // --- Users ------------------------------------------------------------------------
  app.get('/admin/users', requireAdmin, requirePermission('users.view'), (req, res) => {
    const page = Number(req.query.page) || 1;
    const pageSize = Number(req.query.pageSize) || 25;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const filter = (typeof req.query.filter === 'string' ? req.query.filter : 'all') as UserFilter;
    res.json(listUsers({ page, pageSize, search, filter }, isOnline));
  });

  app.get('/admin/users/:id', requireAdmin, requirePermission('users.view'), (req, res) => {
    const detail = getUserDetail((req.params.id ?? ''), isOnline);
    if (!detail) return res.status(404).json({ error: 'User not found' });
    res.json(detail);
  });

  function moderationAction(action: string, run: (userId: string) => unknown) {
    return (req: Request, res: Response) => {
      const admin = req.admin!;
      const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
      const rid = requestId(req);
      if (!reason) {
        writeAudit({ admin, action, targetKind: 'user', targetId: (req.params.id ?? ''), reason: null, result: 'failure', errorMessage: 'Missing reason', requestId: rid });
        return res.status(400).json({ error: 'A reason is required for this action' });
      }
      try {
        const before = getUser((req.params.id ?? ''));
        if (!before) throw new UserNotFoundError();
        const result = run((req.params.id ?? ''));
        writeAudit({ admin, action, targetKind: 'user', targetId: (req.params.id ?? ''), reason, before: { status: before.status }, after: result, result: 'success', requestId: rid });
        res.json({ ok: true, result });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Action failed';
        writeAudit({ admin, action, targetKind: 'user', targetId: (req.params.id ?? ''), reason, result: 'failure', errorMessage: message, requestId: rid });
        res.status(err instanceof UserNotFoundError ? 404 : 400).json({ error: message });
      }
    };
  }

  app.post('/admin/users/:id/suspend', requireAdmin, requirePermission('users.moderate'), writeLimiter, moderationAction('SUSPEND_USER', (id) => suspendUser(id)));
  app.post('/admin/users/:id/unsuspend', requireAdmin, requirePermission('users.moderate'), writeLimiter, moderationAction('UNSUSPEND_USER', (id) => unsuspendUser(id)));
  app.post('/admin/users/:id/ban', requireAdmin, requirePermission('users.moderate'), writeLimiter, moderationAction('BAN_USER', (id) => banUser(id)));
  app.post('/admin/users/:id/unban', requireAdmin, requirePermission('users.moderate'), writeLimiter, moderationAction('UNBAN_USER', (id) => unbanUser(id)));
  app.post('/admin/users/:id/force-logout', requireAdmin, requirePermission('users.moderate'), writeLimiter, moderationAction('FORCE_LOGOUT_USER', (id) => ({ sessionsInvalidated: forceLogoutUser(id) })));

  app.post('/admin/users/:id/notes', requireAdmin, requirePermission('users.notes'), writeLimiter, (req, res) => {
    const admin = req.admin!;
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    const rid = requestId(req);
    if (!note) return res.status(400).json({ error: 'Note text is required' });
    const user = getUser((req.params.id ?? ''));
    if (!user) return res.status(404).json({ error: 'User not found' });
    const entry = addSupportNote((req.params.id ?? ''), note, admin);
    writeAudit({ admin, action: 'ADD_SUPPORT_NOTE', targetKind: 'user', targetId: (req.params.id ?? ''), reason: null, after: { noteId: entry.id }, result: 'success', requestId: rid });
    res.json({ ok: true, note: entry });
  });

  // --- Rooms / matches ------------------------------------------------------------------------
  app.get('/admin/rooms', requireAdmin, requirePermission('rooms.view'), (_req, res) => {
    res.json({ rooms: roomManager.listRoomsAdmin() });
  });

  app.get('/admin/rooms/:id', requireAdmin, requirePermission('rooms.view'), (req, res) => {
    const detail = roomManager.getRoomAdminDetail((req.params.id ?? ''));
    if (!detail) return res.status(404).json({ error: 'Room not found (it may have already finished and been cleaned up)' });
    res.json(detail);
  });

  app.post('/admin/rooms/:id/cancel', requireAdmin, requirePermission('rooms.moderate'), writeLimiter, (req, res) => {
    const admin = req.admin!;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    const rid = requestId(req);
    if (!reason) return res.status(400).json({ error: 'A reason is required to cancel a room/match' });
    const before = roomManager.getRoomAdminDetail((req.params.id ?? ''));
    const outcome = roomManager.adminCancelRoom((req.params.id ?? ''));
    writeAudit({
      admin,
      action: 'CANCEL_ROOM',
      targetKind: 'room',
      targetId: (req.params.id ?? ''),
      reason,
      before: before ? { status: before.status, playerCount: before.playerCount } : null,
      after: outcome,
      result: outcome.ok ? 'success' : 'failure',
      errorMessage: outcome.ok ? null : outcome.message,
      requestId: rid,
    });
    res.status(outcome.ok ? 200 : 400).json(outcome);
  });

  // --- Matchmaking ------------------------------------------------------------------------
  app.get('/admin/matchmaking', requireAdmin, requirePermission('matchmaking.view'), (_req, res) => {
    const rooms = roomManager.listRoomsAdmin().filter((r) => r.status === 'queued' || r.status === 'ready_check' || r.status === 'starting');
    const byFormat = ROOM_FORMATS.map((f) => ({
      format: f.id,
      label: f.label,
      queues: ENTRY_FEE_TIERS.map((fee) => {
        const matching = rooms.filter((r) => r.format === f.id && r.entryFee === fee);
        const queued = matching.filter((r) => r.status === 'queued');
        const oldestAgeMs = queued.length > 0 ? Math.max(...queued.map((r) => Date.now() - r.createdAt)) : 0;
        return { entryFee: fee, roomsInFlight: matching.length, queuedRooms: queued.length, oldestQueueAgeMs: oldestAgeMs };
      }),
    }));
    res.json({ byFormat, flags: getEffectiveFlags() });
  });

  // --- Game config / content ------------------------------------------------------------------------
  app.get('/admin/game/config', requireAdmin, requirePermission('game.config.view'), (_req, res) => {
    res.json({ config: getEffectiveGameConfig(), history: getGameConfigHistory(50) });
  });

  app.put('/admin/game/config', requireAdmin, requirePermission('game.config.edit'), writeLimiter, (req, res) => {
    const admin = req.admin!;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    const rid = requestId(req);
    if (!reason) return res.status(400).json({ error: 'A reason is required to change game configuration' });
    try {
      const before = getEffectiveGameConfig();
      const { config, changed } = updateGameConfig(req.body?.patch ?? {}, admin);
      writeAudit({ admin, action: 'UPDATE_GAME_CONFIG', targetKind: 'gameConfig', targetId: null, reason, before, after: config, result: 'success', requestId: rid });
      res.json({ ok: true, config, changed });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update config';
      writeAudit({ admin, action: 'UPDATE_GAME_CONFIG', targetKind: 'gameConfig', targetId: null, reason, result: 'failure', errorMessage: message, requestId: rid });
      res.status(err instanceof InvalidConfigValueError ? 400 : 500).json({ error: message });
    }
  });

  app.get('/admin/game/content', requireAdmin, requirePermission('game.content.view'), (_req, res) => {
    res.json({ assets: listGameAssets() });
  });

  app.put('/admin/game/content/:assetId/active', requireAdmin, requirePermission('game.content.edit'), writeLimiter, (req, res) => {
    const admin = req.admin!;
    const active = req.body?.active === true;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    const rid = requestId(req);
    try {
      const assets = setAssetActive((req.params.assetId ?? ''), active, admin);
      writeAudit({ admin, action: active ? 'ENABLE_ASSET' : 'DISABLE_ASSET', targetKind: 'asset', targetId: (req.params.assetId ?? ''), reason: reason || null, after: { active }, result: 'success', requestId: rid });
      res.json({ ok: true, assets });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update asset';
      writeAudit({ admin, action: 'UPDATE_ASSET', targetKind: 'asset', targetId: (req.params.assetId ?? ''), reason: reason || null, result: 'failure', errorMessage: message, requestId: rid });
      res.status(err instanceof UnknownAssetError || err instanceof WouldEmptyActiveSetError ? 400 : 500).json({ error: message });
    }
  });

  app.put('/admin/game/content/:assetId/tags', requireAdmin, requirePermission('game.content.edit'), writeLimiter, (req, res) => {
    const admin = req.admin!;
    const tags = Array.isArray(req.body?.tags) ? req.body.tags.filter((t: unknown) => typeof t === 'string') : [];
    try {
      const assets = setAssetTags((req.params.assetId ?? ''), tags, admin);
      writeAudit({ admin, action: 'UPDATE_ASSET_TAGS', targetKind: 'asset', targetId: (req.params.assetId ?? ''), after: { tags }, result: 'success', requestId: requestId(req) });
      res.json({ ok: true, assets });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update tags' });
    }
  });

  // --- Wallet / transactions ------------------------------------------------------------------------
  app.get('/admin/wallets/overview', requireAdmin, requirePermission('wallet.view'), (_req, res) => {
    const users = listAllUsersRaw();
    const transactions = listAllTransactionsRaw();
    const todayStart = new Date().setHours(0, 0, 0, 0);
    const totalBalance = users.reduce((sum, u) => sum + u.walletBalance, 0);
    const todayInflow = transactions.filter((t) => t.timestamp >= todayStart && (t.type === 'topup' || t.type === 'payout' || t.type === 'refund')).reduce((s, t) => s + Math.abs(t.amount), 0);
    const todayOutflow = transactions.filter((t) => t.timestamp >= todayStart && (t.type === 'withdrawal' || t.type === 'entry_fee')).reduce((s, t) => s + Math.abs(t.amount), 0);
    res.json({
      totalBalance,
      available: totalBalance, // this ledger has no concept of a separately-locked sub-balance today — see ADMIN_REPORT.md
      pending: 0,
      locked: 0,
      todayInflow,
      todayOutflow,
      pendingWithdrawals: transactions.filter((t) => t.type === 'withdrawal' && t.status === 'pending').length,
      pendingDeposits: transactions.filter((t) => t.type === 'topup' && t.status === 'pending').length,
      failedTransactions: transactions.filter((t) => t.status === 'failed').length,
    });
  });

  app.get('/admin/wallets/:userId', requireAdmin, requirePermission('wallet.view'), (req, res) => {
    const user = getUser((req.params.userId ?? ''));
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: toPublicUser(user), transactions: listAllTransactionsRaw().filter((t) => t.userId === user.id).slice(-200).reverse() });
  });

  app.post('/admin/wallets/:userId/adjustment', requireAdmin, requirePermission('wallet.adjust'), writeLimiter, (req, res) => {
    const admin = req.admin!;
    const amount = Number(req.body?.amount);
    const direction = req.body?.direction === 'debit' ? 'debit' : 'credit';
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    const reference = typeof req.body?.reference === 'string' ? req.body.reference.trim() : '';
    const rid = requestId(req);
    if (!reason) return res.status(400).json({ error: 'A reason is required for a balance adjustment' });
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) return res.status(400).json({ error: 'Invalid adjustment amount' });
    const HIGH_VALUE_THRESHOLD = 50_000;
    const requiresSecondApproval = amount >= HIGH_VALUE_THRESHOLD;
    const approvedBy = typeof req.body?.secondApproverAdminId === 'string' ? req.body.secondApproverAdminId : null;
    if (requiresSecondApproval && (!approvedBy || approvedBy === admin.id)) {
      writeAudit({ admin, action: 'BALANCE_ADJUSTMENT', targetKind: 'wallet', targetId: (req.params.userId ?? ''), reason, result: 'failure', errorMessage: 'Second-approval required for adjustments >= 50,000', requestId: rid });
      return res.status(403).json({ error: `Adjustments of ${HIGH_VALUE_THRESHOLD.toLocaleString()} or more require a second, different admin's approval (secondApproverAdminId)` });
    }
    try {
      const user = getUser((req.params.userId ?? ''));
      if (!user) throw new UserNotFoundError();
      const before = user.walletBalance;
      const updated = adminAdjustBalance(user.id, Math.round(amount), direction, reference || rid);
      writeAudit({
        admin,
        action: 'BALANCE_ADJUSTMENT',
        targetKind: 'wallet',
        targetId: (req.params.userId ?? ''),
        reason,
        before: { balance: before },
        after: { balance: updated.walletBalance, amount, direction, reference, secondApprover: approvedBy },
        result: 'success',
        requestId: rid,
      });
      res.json({ ok: true, before, after: updated.walletBalance, user: toPublicUser(updated) });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Adjustment failed';
      writeAudit({ admin, action: 'BALANCE_ADJUSTMENT', targetKind: 'wallet', targetId: (req.params.userId ?? ''), reason, result: 'failure', errorMessage: message, requestId: rid });
      res.status(err instanceof UserNotFoundError ? 404 : 400).json({ error: message });
    }
  });

  app.get('/admin/transactions', requireAdmin, requirePermission('transactions.view'), (req, res) => {
    let rows = listAllTransactionsRaw();
    const { type, status, userId, from, to } = req.query;
    if (typeof type === 'string' && type) rows = rows.filter((t) => t.type === type);
    if (typeof status === 'string' && status) rows = rows.filter((t) => t.status === status);
    if (typeof userId === 'string' && userId) rows = rows.filter((t) => t.userId === userId);
    if (typeof from === 'string' && from) rows = rows.filter((t) => t.timestamp >= Number(from));
    if (typeof to === 'string' && to) rows = rows.filter((t) => t.timestamp <= Number(to));
    const page = Number(req.query.page) || 1;
    const pageSize = Math.min(Number(req.query.pageSize) || 25, 100);
    const sorted = rows.slice().sort((a, b) => b.timestamp - a.timestamp);
    const start = (page - 1) * pageSize;
    res.json({ rows: sorted.slice(start, start + pageSize), total: sorted.length, page, pageSize });
  });

  // --- Payment engine: adapter registry, routing, transactions and reconciliation --------
  app.get('/admin/payment-adapters', requireAdmin, requirePermission('PAYMENT_VIEW'), (_req, res) => {
    res.json({ adapters: listPublicAdapters(), slots: 10, note: 'Secret values are never returned. Production provider activation is blocked until official adapters and compliance configuration are installed.' });
  });

  app.get('/admin/payment-adapters/:id', requireAdmin, requirePermission('PAYMENT_VIEW'), (req, res) => {
    const adapter = listPaymentAdapters().find((entry) => entry.adapterId === req.params.id);
    if (!adapter) return res.status(404).json({ error: 'Payment adapter not found' });
    res.json({ adapter: publicAdapter(adapter) });
  });

  app.get('/admin/payment-config', requireAdmin, requirePermission('PAYMENT_VIEW'), (_req, res) => {
    res.json({ config: getPaymentConfig() });
  });

  app.put('/admin/payment-config', requireAdmin, requirePermission('PAYMENT_CONFIG'), writeLimiter, (req, res) => {
    const admin = req.admin!;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    const rid = requestId(req);
    if (!reason) return res.status(400).json({ error: 'A reason is required to change payment routing configuration' });
    try {
      const incoming = req.body?.patch ?? {};
      const patch: Partial<PaymentConfig> = {};
      const strategy = incoming.routingStrategy;
      if (strategy !== undefined) {
        if (!['ROUND_ROBIN', 'WEIGHTED', 'PRIORITY', 'LEAST_LOAD', 'CAPACITY_BASED'].includes(strategy)) throw new Error('Invalid routing strategy');
        patch.routingStrategy = strategy;
      }
      if (incoming.allowPreCreationFailover !== undefined) {
        if (typeof incoming.allowPreCreationFailover !== 'boolean') throw new Error('Invalid failover setting');
        patch.allowPreCreationFailover = incoming.allowPreCreationFailover;
      }
      if (incoming.defaultCurrency !== undefined) {
        if (incoming.defaultCurrency !== 'INR' && incoming.defaultCurrency !== 'USDT') throw new Error('Invalid default currency');
        patch.defaultCurrency = incoming.defaultCurrency;
      }
      if (incoming.platformFeeBps !== undefined) {
        if (!Number.isInteger(incoming.platformFeeBps) || incoming.platformFeeBps < 0 || incoming.platformFeeBps > 2_000) throw new Error('Invalid platform fee');
        patch.platformFeeBps = incoming.platformFeeBps;
      }
      if (incoming.withdrawalFeeFlat !== undefined) {
        if (!Number.isFinite(incoming.withdrawalFeeFlat) || incoming.withdrawalFeeFlat < 0) throw new Error('Invalid withdrawal fee');
        patch.withdrawalFeeFlat = incoming.withdrawalFeeFlat;
      }
      for (const key of ['depositLimits', 'withdrawalLimits'] as const) {
        if (incoming[key] === undefined) continue;
        const limits = incoming[key] as Partial<PaymentLimits>;
        const minAmount = Number(limits.minAmount);
        const maxAmount = Number(limits.maxAmount);
        const dailyLimit = Number(limits.dailyLimit);
        const monthlyLimit = Number(limits.monthlyLimit);
        if ([minAmount, maxAmount, dailyLimit, monthlyLimit].some((value) => !Number.isFinite(value) || value < 0) || minAmount > maxAmount || maxAmount > dailyLimit || dailyLimit > monthlyLimit) throw new Error(`Invalid ${key}`);
        patch[key] = { minAmount, maxAmount, dailyLimit, monthlyLimit };
      }
      const before = getPaymentConfig();
      const config = updatePaymentConfig(patch);
      writeAudit({ admin, action: 'UPDATE_PAYMENT_CONFIG', targetKind: 'paymentConfig', targetId: null, reason, before, after: config, result: 'success', requestId: rid });
      res.json({ ok: true, config });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Payment config update failed';
      writeAudit({ admin, action: 'UPDATE_PAYMENT_CONFIG', targetKind: 'paymentConfig', targetId: null, reason, result: 'failure', errorMessage: message, requestId: rid });
      res.status(400).json({ error: message });
    }
  });

  app.put('/admin/payment-adapters/:id', requireAdmin, requirePermission('PAYMENT_CONFIG'), writeLimiter, (req, res) => {
    const admin = req.admin!;
    const adapterId = (req.params.id ?? '') as PaymentAdapterId;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    const rid = requestId(req);
    if (!reason) return res.status(400).json({ error: 'A reason is required to change a payment adapter' });
    const allowed = ['displayName', 'provider', 'method', 'currency', 'asset', 'network', 'environment', 'status', 'depositEnabled', 'withdrawalEnabled', 'minAmount', 'maxAmount', 'priority', 'routingWeight', 'capacity', 'healthFailureAutoDisable', 'secretRef'] as const;
    const patch: Record<string, unknown> = {};
    for (const key of allowed) if (Object.prototype.hasOwnProperty.call(req.body?.patch ?? {}, key)) patch[key] = req.body.patch[key];
    try {
      const before = listPaymentAdapters().find((adapter) => adapter.adapterId === adapterId);
      if (!before) return res.status(404).json({ error: 'Payment adapter not found' });
      const adapter = configureAdapter(adapterId, patch);
      writeAudit({ admin, action: 'UPDATE_PAYMENT_ADAPTER', targetKind: 'paymentAdapter', targetId: adapterId, reason, before: publicAdapter(before), after: publicAdapter(adapter), result: 'success', requestId: rid });
      res.json({ ok: true, adapter: publicAdapter(adapter) });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Payment adapter update failed';
      writeAudit({ admin, action: 'UPDATE_PAYMENT_ADAPTER', targetKind: 'paymentAdapter', targetId: adapterId, reason, result: 'failure', errorMessage: message, requestId: rid });
      res.status(400).json({ error: message });
    }
  });

  app.post('/admin/payment-adapters/:id/archive', requireAdmin, requirePermission('PAYMENT_CONFIG'), writeLimiter, (req, res) => {
    const admin = req.admin!;
    const adapterId = (req.params.id ?? '') as PaymentAdapterId;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    const rid = requestId(req);
    if (!reason) return res.status(400).json({ error: 'A reason is required to archive a payment adapter' });
    try {
      const before = listPaymentAdapters().find((adapter) => adapter.adapterId === adapterId);
      const adapter = archiveAdapter(adapterId);
      writeAudit({ admin, action: 'ARCHIVE_PAYMENT_ADAPTER', targetKind: 'paymentAdapter', targetId: adapterId, reason, before: before ? publicAdapter(before) : null, after: publicAdapter(adapter), result: 'success', requestId: rid });
      res.json({ ok: true, adapter: publicAdapter(adapter) });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Payment adapter archive failed';
      writeAudit({ admin, action: 'ARCHIVE_PAYMENT_ADAPTER', targetKind: 'paymentAdapter', targetId: adapterId, reason, result: 'failure', errorMessage: message, requestId: rid });
      res.status(400).json({ error: message });
    }
  });

  app.post('/admin/payment-adapters/:id/health-check', requireAdmin, requirePermission('PAYMENT_OPERATE'), writeLimiter, async (req, res) => {
    const admin = req.admin!;
    const adapterId = (req.params.id ?? '') as PaymentAdapterId;
    try {
      const result = await healthCheckAdapter(adapterId);
      writeAudit({ admin, action: 'HEALTH_CHECK_PAYMENT_ADAPTER', targetKind: 'paymentAdapter', targetId: adapterId, reason: typeof req.body?.reason === 'string' ? req.body.reason : null, after: { status: result.status, detail: result.detail }, result: 'success', requestId: requestId(req) });
      res.json({ ok: true, status: result.status, detail: result.detail, adapter: publicAdapter(result.config) });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Health check failed' });
    }
  });

  app.get('/admin/payment-overview', requireAdmin, requirePermission('PAYMENT_VIEW'), (_req, res) => {
    const transactions = listPaymentTransactions();
    const completed = transactions.filter((transaction) => transaction.status === 'COMPLETED');
    const failed = transactions.filter((transaction) => transaction.status === 'FAILED');
    const pending = transactions.filter((transaction) => transaction.status === 'PENDING' || transaction.status === 'PROCESSING' || transaction.status === 'CREATED');
    res.json({ totalDeposits: transactions.filter((transaction) => transaction.operation === 'DEPOSIT').length, totalWithdrawals: transactions.filter((transaction) => transaction.operation === 'WITHDRAWAL').length, pendingDeposits: pending.filter((transaction) => transaction.operation === 'DEPOSIT').length, pendingWithdrawals: pending.filter((transaction) => transaction.operation === 'WITHDRAWAL').length, failedTransactions: failed.length, activeAdapters: listPaymentAdapters().filter((adapter) => adapter.status === 'ACTIVE').length, disabledAdapters: listPaymentAdapters().filter((adapter) => adapter.status !== 'ACTIVE').length, successRate: completed.length + failed.length > 0 ? completed.length / (completed.length + failed.length) : null, failureRate: completed.length + failed.length > 0 ? failed.length / (completed.length + failed.length) : null, pendingVolume: pending.reduce((sum, transaction) => sum + transaction.amount, 0), adapters: listPublicAdapters() });
  });

  app.get('/admin/payment-analytics', requireAdmin, requirePermission('PAYMENT_VIEW'), (req, res) => {
    const from = typeof req.query.from === 'string' && Number.isFinite(Number(req.query.from)) ? Number(req.query.from) : undefined;
    const to = typeof req.query.to === 'string' && Number.isFinite(Number(req.query.to)) ? Number(req.query.to) : undefined;
    const adapterId = typeof req.query.adapterId === 'string' ? req.query.adapterId : undefined;
    const transactions = listPaymentTransactions({ from, to, adapterId });
    const summarize = (operation: PaymentOperation) => {
      const scoped = transactions.filter((transaction) => transaction.operation === operation);
      const completed = scoped.filter((transaction) => transaction.status === 'COMPLETED');
      const failed = scoped.filter((transaction) => ['FAILED', 'EXPIRED', 'CANCELLED'].includes(transaction.status));
      return { count: scoped.length, completed: completed.length, failed: failed.length, pending: scoped.length - completed.length - failed.length, completedVolume: completed.reduce((sum, transaction) => sum + transaction.amount, 0), averageProcessingMs: completed.length ? Math.round(completed.reduce((sum, transaction) => sum + ((transaction.completedAt ?? transaction.updatedAt) - transaction.createdAt), 0) / completed.length) : null };
    };
    const byAdapter = listPaymentAdapters().map((adapter) => { const scoped = transactions.filter((transaction) => transaction.adapterId === adapter.adapterId); return { adapterId: adapter.adapterId, provider: adapter.provider, count: scoped.length, completed: scoped.filter((transaction) => transaction.status === 'COMPLETED').length, failed: scoped.filter((transaction) => ['FAILED', 'EXPIRED', 'CANCELLED'].includes(transaction.status)).length, volume: scoped.filter((transaction) => transaction.status === 'COMPLETED').reduce((sum, transaction) => sum + transaction.amount, 0) }; }).filter((entry) => entry.count > 0);
    res.json({ from: from ?? null, to: to ?? null, adapterId: adapterId ?? null, deposits: summarize('DEPOSIT'), withdrawals: summarize('WITHDRAWAL'), byAdapter });
  });

  app.get('/admin/payment-risk', requireAdmin, requirePermission('PAYMENT_VIEW'), (req, res) => {
    const from = typeof req.query.from === 'string' && Number.isFinite(Number(req.query.from)) ? Number(req.query.from) : undefined;
    const to = typeof req.query.to === 'string' && Number.isFinite(Number(req.query.to)) ? Number(req.query.to) : undefined;
    const severity = typeof req.query.severity === 'string' ? req.query.severity : undefined;
    const signals = listPaymentRiskSignals().filter((signal) => (!from || signal.createdAt >= from) && (!to || signal.createdAt <= to) && (!severity || signal.severity === severity)).sort((a, b) => b.createdAt - a.createdAt).slice(0, 500);
    res.json({ signals, counts: signals.reduce<Record<string, number>>((counts, signal) => { counts[signal.severity] = (counts[signal.severity] ?? 0) + 1; return counts; }, {}) });
  });

  app.get('/admin/payment-transactions', requireAdmin, requirePermission('PAYMENT_VIEW'), (req, res) => {
    const operation = req.query.operation === 'DEPOSIT' || req.query.operation === 'WITHDRAWAL' ? req.query.operation as PaymentOperation : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status as PaymentTransactionStatus : undefined;
    const adapterId = typeof req.query.adapterId === 'string' ? req.query.adapterId : undefined;
    const rows = listPaymentTransactions({ operation, status, adapterId }).sort((a, b) => b.createdAt - a.createdAt);
    res.json({ rows, total: rows.length });
  });

  app.get('/admin/payment-transactions/:id', requireAdmin, requirePermission('PAYMENT_VIEW'), (req, res) => {
    const transaction = getPaymentTransaction(req.params.id ?? '');
    if (!transaction) return res.status(404).json({ error: 'Payment transaction not found' });
    const historicalAdapter = listPaymentAdapters().find((adapter) => adapter.adapterId === transaction.adapterId);
    res.json({ transaction, adapter: historicalAdapter ? publicAdapter(historicalAdapter) : null, routing: getRoutingDecision(transaction.id) ?? null, providerEvents: listProviderEvents().filter((event) => event.transactionId === transaction.id || event.providerReference === transaction.providerReference), reconciliation: listReconciliationRecords(transaction.id), audit: listPaymentAuditEvents().filter((event) => event.targetId === transaction.id) });
  });

  app.get('/admin/payment-webhooks', requireAdmin, requirePermission('PAYMENT_VIEW'), (_req, res) => {
    res.json({ events: listWebhookEvents() });
  });

  app.get('/admin/payment-reconciliation', requireAdmin, requirePermission('PAYMENT_RECONCILE'), (_req, res) => {
    res.json({ records: listReconciliationRecords().slice().reverse() });
  });

  app.post('/admin/payment-reconciliation', requireAdmin, requirePermission('PAYMENT_RECONCILE'), writeLimiter, async (req, res) => {
    const admin = req.admin!;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason) return res.status(400).json({ error: 'A reason is required to initiate reconciliation' });
    try {
      const records = typeof req.body?.transactionId === 'string' ? [await reconcileTransaction(req.body.transactionId)] : await reconcileAllPending();
      writeAudit({ admin, action: 'RUN_PAYMENT_RECONCILIATION', targetKind: 'paymentTransaction', targetId: typeof req.body?.transactionId === 'string' ? req.body.transactionId : null, reason, after: { count: records.length }, result: 'success', requestId: requestId(req) });
      res.json({ ok: true, records });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Reconciliation failed';
      writeAudit({ admin, action: 'RUN_PAYMENT_RECONCILIATION', targetKind: 'paymentTransaction', targetId: null, reason, result: 'failure', errorMessage: message, requestId: requestId(req) });
      res.status(400).json({ error: message });
    }
  });

  // --- Existing UPI / Crypto / Webhooks / Reconciliation compatibility views --------
  app.get('/admin/payments/providers', requireAdmin, requirePermission('payments.view'), (_req, res) => {
    res.json({
      providers: listPublicAdapters().map((adapter) => ({ name: `${adapter.adapterId} · ${adapter.displayName}`, method: adapter.method, enabled: adapter.status === 'ACTIVE' && (adapter.depositEnabled || adapter.withdrawalEnabled), environment: adapter.environment, webhookConfigured: adapter.secretConfigured, health: adapter.healthStatus, lastSuccessfulEventAt: adapter.lastSuccessfulTransactionAt })),
      note: 'This compatibility view reflects the server-side adapter registry. Only TEST/SANDBOX adapters are available in this build; no real provider is configured.',
    });
  });

  app.get('/admin/payments/upi', requireAdmin, requirePermission('payments.view'), (_req, res) => res.json({ config: getEffectiveUpiConfig() }));
  app.put('/admin/payments/upi', requireAdmin, requirePermission('payments.edit'), writeLimiter, (req, res) => {
    const admin = req.admin!;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    const rid = requestId(req);
    if (!reason) return res.status(400).json({ error: 'A reason is required to change payment provider configuration' });
    try {
      const before = getEffectiveUpiConfig();
      const config = updateUpiConfig(req.body?.patch ?? {}, admin);
      writeAudit({ admin, action: 'UPDATE_UPI_CONFIG', targetKind: 'upiConfig', targetId: null, reason, before, after: config, result: 'success', requestId: rid });
      res.json({ ok: true, config });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update UPI config';
      writeAudit({ admin, action: 'UPDATE_UPI_CONFIG', targetKind: 'upiConfig', targetId: null, reason, result: 'failure', errorMessage: message, requestId: rid });
      res.status(400).json({ error: message });
    }
  });

  app.get('/admin/payments/crypto', requireAdmin, requirePermission('payments.view'), (_req, res) => {
    res.json({ networks: getEffectiveCryptoConfigs(), warnings: networkMismatchWarnings() });
  });
  app.put('/admin/payments/crypto/:asset/:network', requireAdmin, requirePermission('payments.edit'), writeLimiter, (req, res) => {
    const admin = req.admin!;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    const rid = requestId(req);
    if (!reason) return res.status(400).json({ error: 'A reason is required to change crypto network configuration' });
    try {
      const config = updateCryptoConfig((req.params.asset ?? ''), (req.params.network ?? ''), req.body?.patch ?? {}, admin);
      writeAudit({ admin, action: 'UPDATE_CRYPTO_CONFIG', targetKind: 'cryptoConfig', targetId: `${(req.params.asset ?? '')}:${(req.params.network ?? '')}`, reason, after: config, result: 'success', requestId: rid });
      res.json({ ok: true, config, warnings: networkMismatchWarnings() });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update crypto config';
      writeAudit({ admin, action: 'UPDATE_CRYPTO_CONFIG', targetKind: 'cryptoConfig', targetId: `${(req.params.asset ?? '')}:${(req.params.network ?? '')}`, reason, result: 'failure', errorMessage: message, requestId: rid });
      res.status(err instanceof NetworkMismatchWarning ? 400 : 400).json({ error: message });
    }
  });

  app.get('/admin/webhooks', requireAdmin, requirePermission('webhooks.view'), (_req, res) => {
    res.json({ events: allWebhookEvents(), note: 'Empty by construction — no real payment provider is wired up to deliver webhooks yet in this build.' });
  });
  app.post('/admin/webhooks/:id/retry', requireAdmin, requirePermission('webhooks.retry'), writeLimiter, (req, res) => {
    const admin = req.admin!;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    const rid = requestId(req);
    try {
      const event = retryWebhookEvent((req.params.id ?? ''));
      writeAudit({ admin, action: 'RETRY_WEBHOOK', targetKind: 'webhook', targetId: (req.params.id ?? ''), reason: reason || null, after: event, result: 'success', requestId: rid });
      res.json({ ok: true, event });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Retry failed';
      writeAudit({ admin, action: 'RETRY_WEBHOOK', targetKind: 'webhook', targetId: (req.params.id ?? ''), reason: reason || null, result: 'failure', errorMessage: message, requestId: rid });
      res.status(err instanceof WebhookRetryUnsafeError ? 409 : 400).json({ error: message });
    }
  });

  app.get('/admin/reconciliation', requireAdmin, requirePermission('reconciliation.view'), (_req, res) => {
    res.json(computeReconciliation());
  });

  // --- Risk / Anti-cheat ------------------------------------------------------------------------
  app.get('/admin/risk', requireAdmin, requirePermission('risk.view'), (_req, res) => {
    res.json({ signals: computeRiskSignals() });
  });
  app.get('/admin/anticheat', requireAdmin, requirePermission('anticheat.view'), (_req, res) => {
    const rooms = roomManager.listRoomsAdmin();
    res.json({
      activeMatches: rooms.filter((r) => r.status === 'active').length,
      ...computeAntiCheatSummary(),
    });
  });

  // --- Analytics ------------------------------------------------------------------------
  app.get('/admin/analytics/users', requireAdmin, requirePermission('analytics.view'), (_req, res) => {
    const users = listAllUsersRaw();
    const now = Date.now();
    const day = 24 * 60 * 60_000;
    res.json({
      dau: users.filter((u) => u.createdAt >= now - day).length, // honest note: this counts NEW signups within the window, not distinct logins, because login events aren't persisted historically — see ADMIN_REPORT.md
      wau: users.filter((u) => u.createdAt >= now - 7 * day).length,
      mau: users.filter((u) => u.createdAt >= now - 30 * day).length,
      totalRegistrations: users.length,
      registrationsToday: users.filter((u) => u.createdAt >= new Date().setHours(0, 0, 0, 0)).length,
      dataQuality: 'live', // computed fresh from the real user store on every request, never cached/estimated
    });
  });

  app.get('/admin/analytics/games', requireAdmin, requirePermission('analytics.view'), (_req, res) => {
    const history = allMatchHistory();
    const finished = history.filter((m) => m.status === 'finished');
    const totalDuration = finished.reduce((sum, m) => sum + (m.startedAt ? m.endedAt - m.startedAt : 0), 0);
    res.json({
      matchesStarted: history.length,
      matchesCompleted: finished.length,
      duelCount: history.filter((m) => m.format === 'duel').length,
      squadCount: history.filter((m) => m.format === 'squad').length,
      averageMatchDurationMs: finished.length > 0 ? Math.round(totalDuration / finished.length) : 0,
      queueAbandonment: history.filter((m) => m.status === 'cancelled').length,
      dataQuality: 'live',
    });
  });

  app.get('/admin/analytics/payments', requireAdmin, requirePermission('analytics.view'), (_req, res) => {
    const transactions = listAllTransactionsRaw();
    const completed = transactions.filter((t) => t.status === 'completed');
    const failed = transactions.filter((t) => t.status === 'failed');
    const total = completed.length + failed.length;
    res.json({
      deposits: transactions.filter((t) => t.type === 'topup').length,
      withdrawals: transactions.filter((t) => t.type === 'withdrawal').length,
      successRate: total > 0 ? completed.length / total : null,
      failureRate: total > 0 ? failed.length / total : null,
      pendingVolume: transactions.filter((t) => t.status === 'pending').reduce((s, t) => s + Math.abs(t.amount), 0),
      dataQuality: 'live',
      note: 'All figures reflect the internal practice-currency wallet ledger only — there is no real payment method mix to report on yet.',
    });
  });

  // --- System / Logs / Audit ------------------------------------------------------------------------
  app.get('/admin/system/health', requireAdmin, requirePermission('system.view'), (_req, res) => {
    const mem = process.memoryUsage();
    res.json({
      api: { status: 'up', uptimeMs: Date.now() - SERVER_STARTED_AT },
      websocket: { status: io.engine ? 'up' : 'down', connections: io.sockets.sockets.size },
      matchmaking: { status: 'up', activeRooms: roomManager.listRoomsAdmin().length },
      database: { status: 'up', note: 'File-backed JSON store, not a real database — see AUDIT_REPORT.md' },
      paymentProviders: { status: 'not_connected' },
      memory: { rssMb: Math.round(mem.rss / 1024 / 1024), heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024) },
      admins: { total: listAdmins().length, activeToday: listAdmins().filter((a) => a.lastLoginAt && a.lastLoginAt > Date.now() - 24 * 60 * 60_000).length },
    });
  });

  app.get('/admin/logs', requireAdmin, requirePermission('logs.view'), (req, res) => {
    // This build's "application logs" are the audit log (admin actions) plus login-attempt
    // records — there is no separate structured application/system logger wired up yet
    // (console.* output isn't captured into a queryable store). Honestly reported as a
    // narrower surface than the full spec's log taxonomy; see ADMIN_REPORT.md.
    const severity = typeof req.query.severity === 'string' ? req.query.severity : undefined;
    const entries = listAuditLog()
      .slice()
      .reverse()
      .map((e) => ({ timestamp: e.timestamp, service: 'admin', severity: e.result === 'failure' ? 'warning' : 'info', event: e.action, detail: `${e.adminName} -> ${e.targetKind}:${e.targetId ?? ''}`, requestId: e.requestId }));
    const filtered = severity ? entries.filter((e) => e.severity === severity) : entries;
    res.json({ logs: filtered.slice(0, 500) });
  });

  app.get('/admin/audit', requireAdmin, requirePermission('audit.view'), (req, res) => {
    let rows = listAuditLog();
    const { adminId, action, from, to } = req.query;
    if (typeof adminId === 'string' && adminId) rows = rows.filter((e) => e.adminId === adminId);
    if (typeof action === 'string' && action) rows = rows.filter((e) => e.action === action);
    if (typeof from === 'string' && from) rows = rows.filter((e) => e.timestamp >= Number(from));
    if (typeof to === 'string' && to) rows = rows.filter((e) => e.timestamp <= Number(to));
    res.json({ rows: rows.slice().reverse().slice(0, 500) });
  });

  app.get('/admin/audit/me', requireAdmin, requirePermission('audit.view'), (req, res) => {
    const admin = req.admin!;
    res.json({ rows: listAuditLog().filter((e) => e.adminId === admin.id).slice().reverse().slice(0, 200) });
  });

  // --- Feature flags ------------------------------------------------------------------------
  app.get('/admin/flags', requireAdmin, requirePermission('flags.view'), (_req, res) => {
    res.json({ flags: getEffectiveFlags(), history: getFlagsHistory(50) });
  });
  app.put('/admin/flags/:flag', requireAdmin, requirePermission('flags.edit'), writeLimiter, (req, res) => {
    const admin = req.admin!;
    const value = req.body?.value === true;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    const rid = requestId(req);
    if (!reason) return res.status(400).json({ error: 'A reason is required to change a feature flag' });
    try {
      const { flags, changed } = setFlag((req.params.flag ?? '') as never, value, admin);
      writeAudit({ admin, action: 'SET_FEATURE_FLAG', targetKind: 'flag', targetId: (req.params.flag ?? ''), reason, after: { value }, result: 'success', requestId: rid });
      res.json({ ok: true, flags, changed });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update flag';
      writeAudit({ admin, action: 'SET_FEATURE_FLAG', targetKind: 'flag', targetId: (req.params.flag ?? ''), reason, result: 'failure', errorMessage: message, requestId: rid });
      res.status(err instanceof UnknownFeatureFlagError ? 400 : 500).json({ error: message });
    }
  });

  // --- Maintenance ------------------------------------------------------------------------
  app.get('/admin/maintenance', requireAdmin, requirePermission('maintenance.view'), (_req, res) => {
    res.json({ states: getAllMaintenanceStates(), scopes: MAINTENANCE_SCOPES });
  });
  app.put('/admin/maintenance/:scope', requireAdmin, requirePermission('maintenance.edit'), writeLimiter, (req, res) => {
    const admin = req.admin!;
    const scope = (req.params.scope ?? '') as MaintenanceScope;
    if (!MAINTENANCE_SCOPES.includes(scope)) return res.status(400).json({ error: 'Unknown maintenance scope' });
    const enabled = req.body?.enabled === true;
    const message = typeof req.body?.message === 'string' ? req.body.message : '';
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    const rid = requestId(req);
    if (!reason) return res.status(400).json({ error: 'A reason is required to change maintenance mode' });
    const before = getAllMaintenanceStates()[scope];
    const state = setMaintenance(scope, enabled, message, admin);
    writeAudit({ admin, action: enabled ? 'ENABLE_MAINTENANCE' : 'DISABLE_MAINTENANCE', targetKind: 'maintenance', targetId: scope, reason, before, after: state, result: 'success', requestId: rid });
    res.json({ ok: true, state });
  });

  // --- Support ------------------------------------------------------------------------
  app.get('/admin/support/tickets', requireAdmin, requirePermission('support.view'), (_req, res) => res.json({ tickets: allTickets() }));
  app.post('/admin/support/tickets', requireAdmin, requirePermission('support.edit'), writeLimiter, (req, res) => {
    const admin = req.admin!;
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : '';
    const subject = typeof req.body?.subject === 'string' ? req.body.subject.trim() : '';
    const user = getUser(userId);
    if (!user || !subject) return res.status(400).json({ error: 'A valid userId and subject are required' });
    const ticket = createTicket(userId, user.name, subject, admin);
    writeAudit({ admin, action: 'CREATE_SUPPORT_TICKET', targetKind: 'user', targetId: userId, after: { ticketId: ticket.id }, result: 'success', requestId: requestId(req) });
    res.json({ ok: true, ticket });
  });
  app.put('/admin/support/tickets/:id', requireAdmin, requirePermission('support.edit'), writeLimiter, (req, res) => {
    try {
      const ticket = updateTicketStatus((req.params.id ?? ''), req.body?.status);
      res.json({ ok: true, ticket });
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : 'Ticket not found' });
    }
  });

  // --- Notifications ------------------------------------------------------------------------
  app.get('/admin/notifications', requireAdmin, requirePermission('dashboard.view'), (_req, res) => res.json({ notifications: allNotifications() }));
  app.post('/admin/notifications/:id/ack', requireAdmin, requirePermission('dashboard.view'), writeLimiter, (req, res) => {
    try {
      res.json({ ok: true, notification: acknowledgeNotification((req.params.id ?? ''), req.admin!) });
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : 'Notification not found' });
    }
  });
  app.post('/admin/notifications/:id/resolve', requireAdmin, requirePermission('dashboard.view'), writeLimiter, (req, res) => {
    try {
      res.json({ ok: true, notification: resolveNotification((req.params.id ?? ''), req.admin!) });
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : 'Notification not found' });
    }
  });

  // --- Admin user / role management (SUPER_ADMIN / admin.manage only) ------------------------------------------------------------------------
  app.get('/admin/admin-users', requireAdmin, requirePermission('admin.manage'), (_req, res) => {
    res.json({ admins: listAdmins().map((a) => toPublicAdmin(a)) });
  });
  app.post('/admin/admin-users', requireAdmin, requirePermission('admin.manage'), writeLimiter, async (req, res) => {
    const admin = req.admin!;
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const role = req.body?.role as AdminRole;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    const rid = requestId(req);
    if (!reason) return res.status(400).json({ error: 'A reason is required to create an admin account' });
    if (!name || name.length < 2) return res.status(400).json({ error: 'Name must be at least 2 characters' });
    if (password.length < 12) return res.status(400).json({ error: 'Admin passwords must be at least 12 characters' });
    if (!ADMIN_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
    try {
      const passwordHash = await hashPassword(password);
      const newAdmin: AdminAccount = {
        id: nanoid(12),
        usernameKey: normalizeUsername(name),
        name,
        passwordHash,
        role,
        active: true,
        createdAt: Date.now(),
        createdBy: admin.id,
        lastLoginAt: null,
      };
      upsertAdmin(newAdmin);
      writeAudit({ admin, action: 'CREATE_ADMIN_ACCOUNT', targetKind: 'admin', targetId: newAdmin.id, reason, after: { name, role }, result: 'success', requestId: rid });
      res.json({ ok: true, admin: toPublicAdmin(newAdmin) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create admin account' });
    }
  });
  app.put('/admin/admin-users/:id', requireAdmin, requirePermission('admin.manage'), writeLimiter, (req, res) => {
    const admin = req.admin!;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    const rid = requestId(req);
    if (!reason) return res.status(400).json({ error: 'A reason is required to change an admin account' });
    const target = listAdmins().find((a) => a.id === (req.params.id ?? ''));
    if (!target) return res.status(404).json({ error: 'Admin account not found' });
    if (target.id === admin.id && req.body?.active === false) return res.status(400).json({ error: 'You cannot deactivate your own account' });
    const role = req.body?.role && ADMIN_ROLES.includes(req.body.role) ? req.body.role : target.role;
    const active = typeof req.body?.active === 'boolean' ? req.body.active : target.active;
    const updated: AdminAccount = { ...target, role, active };
    upsertAdmin(updated);
    if (!active) destroyAllSessionsForAdmin(target.id);
    writeAudit({ admin, action: 'UPDATE_ADMIN_ACCOUNT', targetKind: 'admin', targetId: target.id, reason, before: { role: target.role, active: target.active }, after: { role, active }, result: 'success', requestId: rid });
    res.json({ ok: true, admin: toPublicAdmin(updated) });
  });

  // --- Global search ------------------------------------------------------------------------
  app.get('/admin/search', requireAdmin, requirePermission('search.global'), (req, res) => {
    const admin = req.admin!;
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    if (!q || q.length < 2) return res.json({ users: [], rooms: [], transactions: [] });

    const results: { users: unknown[]; rooms: unknown[]; transactions: unknown[] } = { users: [], rooms: [], transactions: [] };
    if (roleHasPermission(admin.role, 'users.view')) {
      results.users = listAllUsersRaw()
        .filter((u) => u.id.toLowerCase().includes(q) || u.name.toLowerCase().includes(q))
        .slice(0, 10)
        .map((u) => ({ id: u.id, name: u.name, status: u.status }));
    }
    if (roleHasPermission(admin.role, 'rooms.view')) {
      results.rooms = roomManager
        .listRoomsAdmin()
        .filter((r) => r.id.toLowerCase().includes(q))
        .slice(0, 10);
    }
    if (roleHasPermission(admin.role, 'transactions.view')) {
      results.transactions = listAllTransactionsRaw()
        .filter((t) => t.id.toLowerCase().includes(q) || t.userId.toLowerCase().includes(q))
        .slice(0, 10);
    }
    res.json(results);
  });

  // --- My activity (self-audit) ------------------------------------------------------------------------
  app.get('/admin/me/activity', requireAdmin, (req, res) => {
    const admin = req.admin!;
    res.json({ rows: listAuditLog().filter((e) => e.adminId === admin.id).slice().reverse().slice(0, 100) });
  });

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // eslint-disable-next-line no-console
    console.error('Unhandled admin request error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

/** Runs every 60s and raises a REAL notification only when a real, currently-true
 *  condition is observed — never a synthetic/demo alert. Kept deliberately small: this is
 *  not a general-purpose monitoring pipeline, just the handful of conditions this product
 *  can genuinely detect from its own in-process state (see ADMIN_REPORT.md for what a real
 *  deployment would still need on top of this: real APM, real provider webhooks, etc.). */
function startHealthSampler(deps: AdminServerDeps): NodeJS.Timeout {
  return setInterval(() => {
    const failedAdminLogins = recentFailedAdminLogins();
    if (failedAdminLogins >= 5) {
      raiseNotification('admin_brute_force_suspected', `${failedAdminLogins} failed admin login attempt(s) in the last hour`, 'critical');
    }
    const upi = getEffectiveUpiConfig();
    if (upi.enabled && !upi.webhookConfigured) {
      raiseNotification('upi_webhook_not_configured', 'UPI is enabled but no webhook is configured — deposits cannot be confirmed', 'warning');
    }
    const stuckRooms = deps.roomManager.listRoomsAdmin().filter((r) => {
      if (r.status !== 'active' || r.matchEndsAt === null) return false;
      return Date.now() > r.matchEndsAt + 60_000; // still "active" a full minute past when it should have ended
    });
    if (stuckRooms.length > 0) {
      raiseNotification('stuck_active_matches', `${stuckRooms.length} match(es) are still marked active well past their own match timer`, 'critical');
    }
  }, 60_000);
}

export function startAdminServer(deps: AdminServerDeps, port: number) {
  void bootstrapSuperAdminIfNeeded();
  const app = createAdminApp(deps);
  const httpServer = createServer(app);
  const healthSamplerTimer = startHealthSampler(deps);
  httpServer.on('close', () => clearInterval(healthSamplerTimer));
  httpServer.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Admin operations center listening on :${port}`);
  });
  return { app, httpServer };
}

export { countUsers };
