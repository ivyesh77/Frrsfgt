/**
 * File-backed persistence for the entire admin subsystem — a SEPARATE file
 * (admin-store.json) from the player ledger (store.json), so a bug or corruption in one
 * can never touch the other. Same atomic write-temp-then-rename pattern as store.ts, for
 * the same reason (a crash mid-write leaves the last-good file intact).
 *
 * This is intentionally still a single JSON file, not a real database — exactly the same
 * documented, honest limitation as the player store (see store.ts's own doc-comment and
 * AUDIT_REPORT.md). It is namespaced by name specifically so it is obvious in the codebase
 * that admin data and player financial data are two separate concerns.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AdminAccount,
  AdminNotification,
  AuditEntry,
  ConfigFieldHistory,
  CryptoNetworkConfig,
  FlagHistoryEntry,
  GameConfig,
  FeatureFlags,
  LoginAttemptRecord,
  MaintenanceScope,
  MaintenanceState,
  MatchHistoryEntry,
  RiskSignal,
  SupportNote,
  SupportTicket,
  UpiConfig,
  WebhookEvent,
} from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data');
const DATA_FILE = join(DATA_DIR, 'admin-store.json');
const DATA_FILE_TMP = join(DATA_DIR, 'admin-store.json.tmp');

interface AdminDbShape {
  admins: Record<string, AdminAccount>;
  auditLog: AuditEntry[];
  gameConfig: GameConfig | null;
  gameConfigHistory: ConfigFieldHistory[];
  featureFlags: FeatureFlags | null;
  flagHistory: FlagHistoryEntry[];
  maintenance: Record<MaintenanceScope, MaintenanceState>;
  upi: UpiConfig | null;
  crypto: CryptoNetworkConfig[];
  webhookEvents: WebhookEvent[];
  riskSignals: RiskSignal[];
  supportNotes: SupportNote[];
  supportTickets: SupportTicket[];
  notifications: AdminNotification[];
  matchHistory: MatchHistoryEntry[];
  loginAttempts: LoginAttemptRecord[];
  assetOverrides: Record<string, { active: boolean; tags: string[]; updatedAt: number; updatedBy: string }>;
}

function emptyDb(): AdminDbShape {
  return {
    admins: {},
    auditLog: [],
    gameConfig: null,
    gameConfigHistory: [],
    featureFlags: null,
    flagHistory: [],
    maintenance: {} as Record<MaintenanceScope, MaintenanceState>,
    upi: null,
    crypto: [],
    webhookEvents: [],
    riskSignals: [],
    supportNotes: [],
    supportTickets: [],
    notifications: [],
    matchHistory: [],
    loginAttempts: [],
    assetOverrides: {},
  };
}

function loadDb(): AdminDbShape {
  try {
    if (!existsSync(DATA_FILE)) return emptyDb();
    const raw = readFileSync(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AdminDbShape>;
    return { ...emptyDb(), ...parsed };
  } catch {
    return emptyDb();
  }
}

function saveDb(): void {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(DATA_FILE_TMP, JSON.stringify(db, null, 2), 'utf-8');
    renameSync(DATA_FILE_TMP, DATA_FILE);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to persist admin-store.json:', err);
  }
}

let db = loadDb();

// --- Admin accounts ---------------------------------------------------------
export function getAdmin(id: string): AdminAccount | undefined {
  return db.admins[id];
}
export function findAdminByUsernameKey(usernameKey: string): AdminAccount | undefined {
  return Object.values(db.admins).find((a) => a.usernameKey === usernameKey);
}
export function listAdmins(): AdminAccount[] {
  return Object.values(db.admins);
}
export function upsertAdmin(admin: AdminAccount): void {
  db.admins[admin.id] = admin;
  saveDb();
}
export function countAdmins(): number {
  return Object.keys(db.admins).length;
}

// --- Audit log (append-only) ------------------------------------------------
export function appendAuditEntry(entry: AuditEntry): void {
  db.auditLog.push(entry);
  if (db.auditLog.length > 20_000) db.auditLog = db.auditLog.slice(-20_000);
  saveDb();
}
export function listAuditLog(): AuditEntry[] {
  return db.auditLog;
}

// --- Game config -------------------------------------------------------------
export function getStoredGameConfig(): GameConfig | null {
  return db.gameConfig;
}
export function setStoredGameConfig(config: GameConfig): void {
  db.gameConfig = config;
  saveDb();
}
export function appendConfigHistory(entry: ConfigFieldHistory): void {
  db.gameConfigHistory.push(entry);
  if (db.gameConfigHistory.length > 2000) db.gameConfigHistory = db.gameConfigHistory.slice(-2000);
  saveDb();
}
export function getConfigHistory(): ConfigFieldHistory[] {
  return db.gameConfigHistory;
}

// --- Feature flags -------------------------------------------------------------
export function getStoredFlags(): FeatureFlags | null {
  return db.featureFlags;
}
export function setStoredFlags(flags: FeatureFlags): void {
  db.featureFlags = flags;
  saveDb();
}
export function appendFlagHistory(entry: FlagHistoryEntry): void {
  db.flagHistory.push(entry);
  if (db.flagHistory.length > 2000) db.flagHistory = db.flagHistory.slice(-2000);
  saveDb();
}
export function getFlagHistory(): FlagHistoryEntry[] {
  return db.flagHistory;
}

// --- Maintenance -------------------------------------------------------------
export function getMaintenanceMap(): Record<MaintenanceScope, MaintenanceState> {
  return db.maintenance;
}
export function setMaintenanceState(scope: MaintenanceScope, state: MaintenanceState): void {
  db.maintenance[scope] = state;
  saveDb();
}

// --- Payments: UPI / crypto / webhooks ---------------------------------------
export function getUpiConfig(): UpiConfig | null {
  return db.upi;
}
export function setUpiConfig(config: UpiConfig): void {
  db.upi = config;
  saveDb();
}
export function listCryptoConfigs(): CryptoNetworkConfig[] {
  return db.crypto;
}
export function upsertCryptoConfig(config: CryptoNetworkConfig): void {
  const idx = db.crypto.findIndex((c) => c.asset === config.asset && c.network === config.network);
  if (idx >= 0) db.crypto[idx] = config;
  else db.crypto.push(config);
  saveDb();
}
export function listWebhookEvents(): WebhookEvent[] {
  return db.webhookEvents;
}
export function appendWebhookEvent(event: WebhookEvent): void {
  db.webhookEvents.push(event);
  if (db.webhookEvents.length > 5000) db.webhookEvents = db.webhookEvents.slice(-5000);
  saveDb();
}
export function updateWebhookEvent(id: string, patch: Partial<WebhookEvent>): WebhookEvent | undefined {
  const event = db.webhookEvents.find((e) => e.id === id);
  if (!event) return undefined;
  Object.assign(event, patch);
  saveDb();
  return event;
}
export function findWebhookByIdempotencyKey(key: string): WebhookEvent | undefined {
  return db.webhookEvents.find((e) => e.idempotencyKey === key);
}

// --- Risk signals -------------------------------------------------------------
export function appendRiskSignal(signal: RiskSignal): void {
  db.riskSignals.push(signal);
  if (db.riskSignals.length > 5000) db.riskSignals = db.riskSignals.slice(-5000);
  saveDb();
}
export function listRiskSignals(): RiskSignal[] {
  return db.riskSignals;
}

// --- Support -------------------------------------------------------------
export function appendSupportNote(note: SupportNote): void {
  db.supportNotes.push(note);
  saveDb();
}
export function listSupportNotesForUser(userId: string): SupportNote[] {
  return db.supportNotes.filter((n) => n.userId === userId);
}
export function listAllSupportTickets(): SupportTicket[] {
  return db.supportTickets;
}
export function upsertSupportTicket(ticket: SupportTicket): void {
  const idx = db.supportTickets.findIndex((t) => t.id === ticket.id);
  if (idx >= 0) db.supportTickets[idx] = ticket;
  else db.supportTickets.push(ticket);
  saveDb();
}

// --- Notifications -------------------------------------------------------------
export function listNotifications(): AdminNotification[] {
  return db.notifications;
}
export function upsertNotification(notification: AdminNotification): void {
  const idx = db.notifications.findIndex((n) => n.id === notification.id);
  if (idx >= 0) db.notifications[idx] = notification;
  else db.notifications.push(notification);
  if (db.notifications.length > 2000) db.notifications = db.notifications.slice(-2000);
  saveDb();
}

// --- Match history -------------------------------------------------------------
export function appendMatchHistory(entry: MatchHistoryEntry): void {
  db.matchHistory.push(entry);
  if (db.matchHistory.length > 20_000) db.matchHistory = db.matchHistory.slice(-20_000);
  saveDb();
}
export function listMatchHistory(): MatchHistoryEntry[] {
  return db.matchHistory;
}

// --- Login attempts (for brute-force visibility / risk signals) --------------
export function appendLoginAttempt(record: LoginAttemptRecord): void {
  db.loginAttempts.push(record);
  if (db.loginAttempts.length > 20_000) db.loginAttempts = db.loginAttempts.slice(-20_000);
  saveDb();
}
export function listLoginAttempts(): LoginAttemptRecord[] {
  return db.loginAttempts;
}

// --- Game asset overrides (active/inactive/tags on top of the static asset mirror) -------
export function getAssetOverrides(): Record<string, { active: boolean; tags: string[]; updatedAt: number; updatedBy: string }> {
  return db.assetOverrides;
}
export function setAssetOverride(assetId: string, override: { active: boolean; tags: string[]; updatedAt: number; updatedBy: string }): void {
  db.assetOverrides[assetId] = override;
  saveDb();
}

/** Test-only escape hatch so the admin self-test suite starts from a clean slate. */
export function __resetAdminStoreForTests(): void {
  db = emptyDb();
  saveDb();
}
