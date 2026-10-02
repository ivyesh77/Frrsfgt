import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nanoid } from 'nanoid';
import { PAYMENT_ADAPTER_SLOTS, type AdapterHealthStatus, type PaymentAdapterConfig, type PaymentAuditEvent, type PaymentConfig, type PaymentStoreShape, type PaymentTransaction, type PaymentTransactionStatus, type ProviderEvent, type ReconciliationRecord, type RoutingDecision } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data');
const DATA_FILE = join(DATA_DIR, 'payment-store.json');
const DATA_FILE_TMP = join(DATA_DIR, 'payment-store.json.tmp');

function defaultAdapters(): PaymentAdapterConfig[] {
  const now = Date.now();
  return PAYMENT_ADAPTER_SLOTS.map((adapterId, index) => ({
    adapterId,
    displayName: `Payment Slot ${String(index + 1).padStart(2, '0')}`,
    provider: 'sandbox',
    method: index % 2 === 0 ? 'UPI' : 'CRYPTO',
    currency: index % 2 === 0 ? 'INR' : 'USDT',
    ...(index % 2 === 0 ? {} : { asset: 'USDT', network: 'TESTNET' }),
    environment: 'TEST',
    status: 'DISABLED',
    depositEnabled: false,
    withdrawalEnabled: false,
    minAmount: 1,
    maxAmount: 100_000,
    dailyLimit: 50_000,
    paymentExpirySeconds: 600,
    upiId: null,
    qrReference: null,
    priority: index + 1,
    routingWeight: 1,
    capacity: 100,
    healthStatus: 'DISABLED',
    lastHealthCheckAt: null,
    lastSuccessfulTransactionAt: null,
    lastFailedTransactionAt: null,
    successfulCount: 0,
    failedCount: 0,
    pendingCount: 0,
    healthFailureAutoDisable: false,
    secretRef: null,
    configVersion: 1,
    createdAt: now,
    updatedAt: now,
  }));
}

function defaultStore(): PaymentStoreShape {
  return {
    adapters: defaultAdapters(),
    config: {
      routingStrategy: 'PRIORITY',
      allowPreCreationFailover: true,
      defaultCurrency: 'INR',
      platformFeeBps: 0,
      withdrawalFeeFlat: 0,
      depositLimits: { minAmount: 1, maxAmount: 100_000, dailyLimit: 500_000, monthlyLimit: 5_000_000 },
      withdrawalLimits: { minAmount: 1, maxAmount: 100_000, dailyLimit: 500_000, monthlyLimit: 5_000_000 },
      updatedAt: Date.now(),
      updatedBy: null,
      version: 1,
    },
    routingDecisions: [],
    transactions: [],
    providerEvents: [],
    reconciliationRecords: [],
    riskSignals: [],
    auditEvents: [],
    routingCursors: {},
  };
}

function loadStore(): PaymentStoreShape {
  try {
    if (!existsSync(DATA_FILE)) return defaultStore();
    const parsed = JSON.parse(readFileSync(DATA_FILE, 'utf8')) as Partial<PaymentStoreShape>;
    const defaults = defaultStore();
    const adapters = (Array.isArray(parsed.adapters) ? parsed.adapters : defaults.adapters).map((adapter) => ({
      ...defaults.adapters.find((candidate) => candidate.adapterId === adapter.adapterId),
      ...adapter,
    }));
    // Add newly introduced operational slots without changing historical adapter records.
    const byId = new Map(adapters.map((adapter) => [adapter.adapterId, adapter]));
    for (const adapter of defaults.adapters) if (!byId.has(adapter.adapterId)) adapters.push(adapter);
    return {
      ...defaults,
      ...parsed,
      adapters,
      config: { ...defaults.config, ...(parsed.config ?? {}) },
      routingDecisions: Array.isArray(parsed.routingDecisions) ? parsed.routingDecisions : [],
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
      providerEvents: Array.isArray(parsed.providerEvents) ? parsed.providerEvents : [],
      reconciliationRecords: Array.isArray(parsed.reconciliationRecords) ? parsed.reconciliationRecords.map((record) => ({ ...record, resolution: record.resolution ?? null, resolutionNote: record.resolutionNote ?? null })) : [],
      riskSignals: Array.isArray(parsed.riskSignals) ? parsed.riskSignals : [],
      auditEvents: Array.isArray(parsed.auditEvents) ? parsed.auditEvents : [],
      routingCursors: parsed.routingCursors ?? {},
    };
  } catch {
    return defaultStore();
  }
}

function saveStore(): void {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(DATA_FILE_TMP, JSON.stringify(db, null, 2), 'utf8');
    renameSync(DATA_FILE_TMP, DATA_FILE);
  } catch (error) {
    console.error('Failed to persist payment-store.json:', error);
  }
}

let db = loadStore();

export function paymentStoreSnapshot(): PaymentStoreShape {
  return db;
}

export function listPaymentAdapters(): PaymentAdapterConfig[] {
  return db.adapters.slice();
}

export function getPaymentAdapter(adapterId: string): PaymentAdapterConfig | undefined {
  return db.adapters.find((adapter) => adapter.adapterId === adapterId);
}

export function upsertPaymentAdapter(adapter: PaymentAdapterConfig): void {
  const index = db.adapters.findIndex((entry) => entry.adapterId === adapter.adapterId);
  if (index < 0) db.adapters.push(adapter);
  else db.adapters[index] = adapter;
  saveStore();
}

export function addPaymentAdapter(adapter: PaymentAdapterConfig): void {
  if (db.adapters.some((entry) => entry.adapterId === adapter.adapterId)) throw new Error('Payment adapter ID already exists');
  db.adapters.push(adapter);
  saveStore();
}

export function updatePaymentAdapter(adapterId: string, patch: Partial<PaymentAdapterConfig>): PaymentAdapterConfig | undefined {
  const adapter = getPaymentAdapter(adapterId);
  if (!adapter) return undefined;
  Object.assign(adapter, patch, { updatedAt: Date.now() });
  saveStore();
  return adapter;
}

export function getPaymentConfig(): PaymentConfig {
  return db.config;
}

export function updatePaymentConfig(patch: Partial<PaymentConfig>): PaymentConfig {
  db.config = { ...db.config, ...patch, version: db.config.version + 1, updatedAt: Date.now() };
  saveStore();
  return db.config;
}

export function addRoutingDecision(decision: RoutingDecision): void {
  db.routingDecisions.push(decision);
  if (db.routingDecisions.length > 50_000) db.routingDecisions = db.routingDecisions.slice(-50_000);
  saveStore();
}

export function getRoutingDecision(transactionId: string): RoutingDecision | undefined {
  return db.routingDecisions.find((decision) => decision.transactionId === transactionId);
}

export function addPaymentTransaction(transaction: PaymentTransaction): void {
  db.transactions.push(transaction);
  saveStore();
}

export function updatePaymentTransaction(id: string, patch: Partial<PaymentTransaction>): PaymentTransaction | undefined {
  const transaction = db.transactions.find((entry) => entry.id === id);
  if (!transaction) return undefined;
  Object.assign(transaction, patch, { updatedAt: Date.now() });
  saveStore();
  return transaction;
}

export function getPaymentTransaction(id: string): PaymentTransaction | undefined {
  return db.transactions.find((transaction) => transaction.id === id);
}

export function findPaymentByIdempotency(userId: string, operation: PaymentTransaction['operation'], key: string): PaymentTransaction | undefined {
  return db.transactions.find((transaction) => transaction.userId === userId && transaction.operation === operation && transaction.clientIdempotencyKey === key);
}

export function findPaymentByProviderReference(providerReference: string): PaymentTransaction | undefined {
  return db.transactions.find((transaction) => transaction.providerReference === providerReference);
}

export function findPaymentByAnyReference(reference: string): PaymentTransaction | undefined {
  const normalized = reference.trim();
  return db.transactions.find((transaction) => transaction.providerReference === normalized || transaction.operatorReference === normalized || transaction.proof?.reference === normalized);
}

export function listPaymentTransactions(filter: { userId?: string; status?: PaymentTransactionStatus; operation?: PaymentTransaction['operation']; adapterId?: string; from?: number; to?: number } = {}): PaymentTransaction[] {
  return db.transactions.filter((transaction) => {
    if (filter.userId && transaction.userId !== filter.userId) return false;
    if (filter.status && transaction.status !== filter.status) return false;
    if (filter.operation && transaction.operation !== filter.operation) return false;
    if (filter.adapterId && transaction.adapterId !== filter.adapterId) return false;
    if (filter.from && transaction.createdAt < filter.from) return false;
    if (filter.to && transaction.createdAt > filter.to) return false;
    return true;
  });
}

export function addProviderEvent(event: ProviderEvent): void {
  db.providerEvents.push(event);
  if (db.providerEvents.length > 50_000) db.providerEvents = db.providerEvents.slice(-50_000);
  saveStore();
}

export function updateProviderEvent(id: string, patch: Partial<ProviderEvent>): ProviderEvent | undefined {
  const event = db.providerEvents.find((entry) => entry.id === id);
  if (!event) return undefined;
  Object.assign(event, patch);
  saveStore();
  return event;
}

export function findProviderEvent(provider: string, providerEventId: string): ProviderEvent | undefined {
  return db.providerEvents.find((event) => event.provider === provider && event.providerEventId === providerEventId);
}

export function listProviderEvents(): ProviderEvent[] {
  return db.providerEvents.slice();
}

export function addReconciliation(record: ReconciliationRecord): void {
  db.reconciliationRecords.push(record);
  if (db.reconciliationRecords.length > 50_000) db.reconciliationRecords = db.reconciliationRecords.slice(-50_000);
  saveStore();
}

export function listReconciliationRecords(transactionId?: string): ReconciliationRecord[] {
  return db.reconciliationRecords.filter((record) => !transactionId || record.transactionId === transactionId);
}

export function getReconciliationRecord(id: string): ReconciliationRecord | undefined {
  return db.reconciliationRecords.find((record) => record.id === id);
}

export function updateReconciliationRecord(id: string, patch: Partial<ReconciliationRecord>): ReconciliationRecord | undefined {
  const record = getReconciliationRecord(id);
  if (!record) return undefined;
  Object.assign(record, patch);
  saveStore();
  return record;
}

export function addPaymentAudit(event: PaymentAuditEvent): void {
  db.auditEvents.push(event);
  if (db.auditEvents.length > 50_000) db.auditEvents = db.auditEvents.slice(-50_000);
  saveStore();
}

export function listPaymentAuditEvents(): PaymentAuditEvent[] {
  return db.auditEvents.slice();
}

export function addRiskSignal(signal: PaymentStoreShape['riskSignals'][number]): void {
  db.riskSignals.push(signal);
  if (db.riskSignals.length > 50_000) db.riskSignals = db.riskSignals.slice(-50_000);
  saveStore();
}

export function listPaymentRiskSignals(): PaymentStoreShape['riskSignals'] {
  return db.riskSignals.slice();
}

export function nextRoutingCursor(key: string, modulo: number): number {
  const current = db.routingCursors[key] ?? 0;
  db.routingCursors[key] = modulo > 0 ? (current + 1) % modulo : 0;
  saveStore();
  return current;
}

export function recordAdapterHealth(adapterId: string, patch: { healthStatus: AdapterHealthStatus; lastHealthCheckAt: number; healthDetail?: string }): void {
  const adapter = getPaymentAdapter(adapterId);
  if (!adapter) return;
  Object.assign(adapter, patch, { updatedAt: Date.now() });
  saveStore();
}

export function recordAdapterTransaction(adapterId: string, outcome: 'success' | 'failure' | 'pending'): void {
  const adapter = getPaymentAdapter(adapterId);
  if (!adapter) return;
  if (outcome === 'success') {
    adapter.successfulCount += 1;
    adapter.lastSuccessfulTransactionAt = Date.now();
  } else if (outcome === 'failure') {
    adapter.failedCount += 1;
    adapter.lastFailedTransactionAt = Date.now();
  } else {
    adapter.pendingCount += 1;
  }
  saveStore();
}

export function decrementAdapterPending(adapterId: string): void {
  const adapter = getPaymentAdapter(adapterId);
  if (!adapter) return;
  adapter.pendingCount = Math.max(0, adapter.pendingCount - 1);
  saveStore();
}

export function __resetPaymentStoreForTests(): void {
  db = defaultStore();
  saveStore();
}

export { nanoid };
