/** Core types for the admin operations center. This is a deliberately SEPARATE identity
 *  and authorization system from the player-facing one in ../auth.ts / ../types.ts — a
 *  player account can never become an admin session, and an admin session can never act as
 *  a player. Nothing here is client-settable: an admin's role is set once at account
 *  creation (by a SUPER_ADMIN) and is looked up server-side on every single request, never
 *  trusted from a header, cookie payload, or request body. */

import type { MatchHistoryPlayerResult } from '../types.js';

export const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN', 'GAME_OPERATOR', 'PAYMENT_OPERATOR', 'SUPPORT_AGENT', 'ANALYST', 'READ_ONLY'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export interface AdminAccount {
  id: string;
  usernameKey: string;
  name: string;
  passwordHash: string;
  role: AdminRole;
  /** Mirrors the player-side AccountStatus concept — a deactivated admin account can no
   *  longer log in, but its historical audit trail is never deleted. */
  active: boolean;
  createdAt: number;
  createdBy: string | null; // admin id, null only for the bootstrap SUPER_ADMIN
  lastLoginAt: number | null;
}

/** The only admin-account shape ever allowed to leave the server — never passwordHash. */
export interface PublicAdminAccount {
  id: string;
  name: string;
  role: AdminRole;
  active: boolean;
  createdAt: number;
  lastLoginAt: number | null;
}

// ---------------------------------------------------------------------------
// Permissions. Every admin API route declares the exact permission(s) it requires and
// checks them server-side on every request via requirePermission() (see permissions.ts) —
// the admin frontend hiding a nav item or a button is UX polish only, never the actual
// security boundary. A normal player session can never carry any of these regardless
// because it authenticates through a completely different cookie/token namespace that
// this middleware doesn't even look at.
// ---------------------------------------------------------------------------
export const PERMISSIONS = [
  'dashboard.view',
  'users.view',
  'users.search',
  'users.moderate', // suspend/unsuspend/ban/unban/force-logout/flag
  'users.notes', // support notes
  'rooms.view',
  'rooms.moderate', // cancel/force-close a room or match
  'matchmaking.view',
  'matchmaking.moderate', // enable/disable queues, capacity limits
  'game.config.view',
  'game.config.edit',
  'game.content.view',
  'game.content.edit',
  'wallet.view',
  'wallet.adjust', // audited balance adjustment
  'transactions.view',
  'payments.view',
  'payments.edit', // legacy UI aliases retained for compatibility
  'PAYMENT_VIEW',
  'PAYMENT_CONFIG',
  'PAYMENT_OPERATE',
  'PAYMENT_RECONCILE',
  'PAYMENT_ADJUST',
  'PAYMENT_ADMIN',
  'PAYMENT_OPERATOR_ADMIN',
  'webhooks.view',
  'webhooks.retry',
  'reconciliation.view',
  'risk.view',
  'anticheat.view',
  'analytics.view',
  'system.view',
  'logs.view',
  'audit.view',
  'flags.view',
  'flags.edit',
  'maintenance.view',
  'maintenance.edit',
  'support.view',
  'support.edit',
  'admin.manage', // create/deactivate admin accounts, change roles
  'search.global',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** The authoritative, server-side permission matrix. This is the ONLY place role ->
 *  permission mappings are defined; nothing about it is derived from, or overridable by,
 *  anything client-supplied. */
export const ROLE_PERMISSIONS: Record<AdminRole, readonly Permission[]> = {
  SUPER_ADMIN: PERMISSIONS, // full authorized administration
  ADMIN: PERMISSIONS.filter((p) => p !== 'admin.manage' && p !== 'PAYMENT_OPERATOR_ADMIN'), // operational admin, not super-admin/operator management
  GAME_OPERATOR: [
    'dashboard.view',
    'rooms.view',
    'rooms.moderate',
    'matchmaking.view',
    'matchmaking.moderate',
    'game.config.view',
    'game.config.edit',
    'game.content.view',
    'game.content.edit',
    'anticheat.view',
    'analytics.view',
    'search.global',
  ],
  PAYMENT_OPERATOR: [
    'dashboard.view',
    'wallet.view',
    'wallet.adjust',
    'transactions.view',
    'payments.view',
    'payments.edit',
    'PAYMENT_VIEW',
    'PAYMENT_CONFIG',
    'PAYMENT_OPERATE',
    'PAYMENT_RECONCILE',
    'webhooks.view',
    'webhooks.retry',
    'reconciliation.view',
    'analytics.view',
    'search.global',
  ],
  SUPPORT_AGENT: [
    'dashboard.view',
    'users.view',
    'users.search',
    'users.notes',
    'transactions.view', // read-only history, no mutation permission granted
    'support.view',
    'support.edit',
    'search.global',
  ],
  ANALYST: ['dashboard.view', 'analytics.view', 'risk.view', 'search.global'],
  READ_ONLY: [
    'dashboard.view',
    'users.view',
    'rooms.view',
    'matchmaking.view',
    'game.config.view',
    'game.content.view',
    'wallet.view',
    'transactions.view',
    'payments.view',
    'PAYMENT_VIEW',
    'webhooks.view',
    'reconciliation.view',
    'risk.view',
    'anticheat.view',
    'analytics.view',
    'system.view',
    'logs.view',
    'audit.view',
    'flags.view',
    'maintenance.view',
    'support.view',
    'search.global',
  ],
};

export function roleHasPermission(role: AdminRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

// ---------------------------------------------------------------------------
// Audit log. Append-only, never editable/deletable from the normal admin UI (see
// audit.ts) — this is the record of every sensitive action taken through the admin panel.
// ---------------------------------------------------------------------------
export interface AuditEntry {
  id: string;
  timestamp: number;
  adminId: string;
  adminName: string;
  role: AdminRole;
  action: string;
  /** What the action targeted — a user id, room id, transaction id, config key, etc. Kept
   *  as a loose string+kind pair rather than a strict union so new action types never
   *  require a schema migration here. */
  targetKind: string;
  targetId: string | null;
  reason: string | null;
  before: unknown;
  after: unknown;
  result: 'success' | 'failure';
  errorMessage: string | null;
  /** Correlates this audit entry back to the specific HTTP request that produced it — see
   *  server.ts's request-id middleware — so an operator can trace "this exact click"
   *  through server logs too. */
  requestId: string;
}

// ---------------------------------------------------------------------------
// Server-authoritative, admin-editable game configuration. rooms.ts reads these getters
// instead of a hardcoded constant; the player client can never influence any of this.
// ---------------------------------------------------------------------------
export interface GameConfig {
  matchDurationMs: number;
  readyCountdownMs: number;
  roundMemorizeMs: number;
  roundAnswerMs: number;
  lobbyReadyTimeoutMs: number;
  reconnectGraceMs: number;
  correctScoreDelta: number;
  wrongPenaltyDelta: number;
  duelEnabled: boolean;
  squadEnabled: boolean;
}

export interface ConfigFieldHistory {
  key: keyof GameConfig;
  previousValue: unknown;
  newValue: unknown;
  changedBy: string;
  changedByName: string;
  changedAt: number;
}

export interface FeatureFlags {
  duelEnabled: boolean;
  squadEnabled: boolean;
  cryptoEnabled: boolean;
  upiEnabled: boolean;
  dailyModeEnabled: boolean;
  newGameUiEnabled: boolean;
}

export interface FlagHistoryEntry {
  flag: keyof FeatureFlags;
  previousValue: boolean;
  newValue: boolean;
  changedBy: string;
  changedByName: string;
  changedAt: number;
}

export type MaintenanceScope = 'game' | 'matchmaking' | 'wallet' | 'deposit' | 'withdraw' | 'upi' | 'crypto' | 'platform';

export interface MaintenanceState {
  scope: MaintenanceScope;
  enabled: boolean;
  message: string;
  changedBy: string | null;
  changedByName: string | null;
  changedAt: number | null;
}

// ---------------------------------------------------------------------------
// Payment provider / UPI / crypto configuration. Honest scaffolding: this product has no
// real payment processor wired up today (see AUDIT_REPORT.md / SECURITY_FIX_REPORT.md —
// the wallet is an explicitly labeled practice-currency ledger). These structures are real
// and fully functional as CONFIGURATION, and are what a real UPI/crypto integration would
// read from once built, but there is deliberately no fabricated transaction/webhook data
// behind them — see ADMIN_REPORT.md for the explicit, honest accounting of what this does
// and does not do.
// ---------------------------------------------------------------------------
export type PaymentMethod = 'upi' | 'crypto';

export interface UpiConfig {
  enabled: boolean;
  provider: string;
  environment: 'sandbox' | 'production';
  minAmount: number;
  maxAmount: number;
  feeBps: number; // basis points, e.g. 50 = 0.5%
  maintenance: boolean;
  webhookConfigured: boolean;
  lastSuccessfulEventAt: number | null;
  updatedBy: string | null;
  updatedAt: number | null;
}

export interface CryptoNetworkConfig {
  asset: string; // e.g. 'USDT'
  network: string; // e.g. 'TRC20', 'ERC20'
  depositEnabled: boolean;
  withdrawEnabled: boolean;
  minAmount: number;
  maxAmount: number;
  feeFlat: number;
  confirmationsRequired: number;
  maintenance: boolean;
  updatedBy: string | null;
  updatedAt: number | null;
}

export interface WebhookEvent {
  id: string;
  provider: string;
  eventType: string;
  receivedAt: number;
  processedAt: number | null;
  status: 'received' | 'processing' | 'processed' | 'failed' | 'duplicate_ignored';
  retryCount: number;
  errorReason: string | null;
  /** The internal transaction/reference this event resolved to, once known — used to trace
   *  an event through to a ledger effect. Null until (if ever) matched. */
  relatedTransactionId: string | null;
  /** Idempotency key the provider is expected to send — used to detect and safely ignore a
   *  duplicate delivery of the exact same event (a real provider WILL redeliver). */
  idempotencyKey: string;
}

export type RiskSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface RiskSignal {
  id: string;
  userId: string | null;
  userName: string | null;
  kind: string;
  severity: RiskSeverity;
  detail: string;
  createdAt: number;
  evidence: Record<string, unknown>;
}

export interface SupportNote {
  id: string;
  userId: string;
  authorAdminId: string;
  authorName: string;
  note: string;
  createdAt: number;
}

export type SupportTicketStatus = 'open' | 'in_progress' | 'waiting' | 'resolved' | 'closed';
export type SupportTicketCategory = 'account' | 'wallet' | 'payment' | 'gameplay' | 'other';
export interface SupportTicket {
  id: string;
  userId: string;
  userName: string;
  subject: string;
  /** The player's own description of the issue — present for player-opened tickets, null
   *  for the handful created directly by an admin on a player's behalf (see
   *  support.ts createTicket, the pre-existing admin-only path, left unchanged). */
  message: string | null;
  category: SupportTicketCategory;
  status: SupportTicketStatus;
  createdAt: number;
  updatedAt: number;
  /** Null when a PLAYER opened this ticket themselves — the pre-existing admin-initiated
   *  path still always sets this. Never client-settable either way. */
  createdByAdminId: string | null;
}

export type NotificationSeverity = 'info' | 'warning' | 'critical';
export type NotificationStatus = 'open' | 'acknowledged' | 'resolved';
export interface AdminNotification {
  id: string;
  severity: NotificationSeverity;
  kind: string;
  message: string;
  createdAt: number;
  status: NotificationStatus;
  acknowledgedBy: string | null;
  resolvedBy: string | null;
  updatedAt: number;
}

/** A lightweight, append-only summary of every finished/cancelled match — recorded because
 *  live Room objects are deleted from memory shortly after a match ends (see rooms.ts), so
 *  without this there would be nothing left for admin room history / analytics to read. */
export interface MatchHistoryEntry {
  roomId: string;
  gameKind: string;
  format: string;
  entryFee: number;
  pool: number;
  platformCut: number;
  playerCount: number;
  status: 'finished' | 'cancelled';
  endedBy: 'timer' | 'forfeit' | 'admin_cancelled' | 'ready_timeout' | null;
  isVoidMatch: boolean;
  isDraw: boolean;
  startedAt: number | null;
  endedAt: number;
  playerIds: string[];
  winnerIds: string[];
  /** Full real per-player snapshot (real userId, never redacted here) — empty for a
   *  cancelled match, since gameplay never actually started. See MatchHistoryPlayerResult's
   *  own doc-comment for why this is safe server-side storage. */
  results: MatchHistoryPlayerResult[];
}

export interface LoginAttemptRecord {
  id: string;
  actor: 'player' | 'admin';
  usernameAttempted: string;
  success: boolean;
  timestamp: number;
  ip: string;
}
