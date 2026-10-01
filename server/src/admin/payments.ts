/**
 * Payment provider / UPI / crypto CONFIGURATION management.
 *
 * IMPORTANT, read before wiring a UI to this: this product has no real payment processor
 * integrated anywhere (see AUDIT_REPORT.md / SECURITY_FIX_REPORT.md — the wallet is an
 * explicitly labeled practice-currency ledger with no deposit/withdraw gateway behind it).
 * These functions and the config they manage are real and fully functional as
 * CONFIGURATION — exactly what a real UPI/crypto integration would read once built — but
 * there is deliberately no fabricated transaction, webhook, or reconciliation data
 * generated here. Every list this module returns is either genuinely empty (correctly, for
 * a system with no real provider events) or reflects the real internal ledger. Never
 * invent numbers to make this section look more populated than it is — see ADMIN_REPORT.md.
 */
import { nanoid } from 'nanoid';
import { listAllTransactionsRaw } from '../store.js';
import type { AdminAccount, CryptoNetworkConfig, UpiConfig, WebhookEvent } from './types.js';
import {
  appendWebhookEvent,
  findWebhookByIdempotencyKey,
  getUpiConfig,
  listCryptoConfigs,
  listWebhookEvents,
  setUpiConfig,
  updateWebhookEvent,
  upsertCryptoConfig,
} from './store.js';

const DEFAULT_UPI: UpiConfig = {
  enabled: false,
  provider: 'none-configured',
  environment: 'sandbox',
  minAmount: 10,
  maxAmount: 100_000,
  feeBps: 0,
  maintenance: false,
  webhookConfigured: false,
  lastSuccessfulEventAt: null,
  updatedBy: null,
  updatedAt: null,
};

export function getEffectiveUpiConfig(): UpiConfig {
  return getUpiConfig() ?? DEFAULT_UPI;
}

export function updateUpiConfig(patch: Partial<UpiConfig>, admin: AdminAccount): UpiConfig {
  const current = getEffectiveUpiConfig();
  const next: UpiConfig = { ...current, ...patch, updatedBy: admin.id, updatedAt: Date.now() };
  if (next.minAmount < 0 || next.maxAmount <= next.minAmount) throw new Error('Invalid min/max amount range');
  if (next.feeBps < 0 || next.feeBps > 2000) throw new Error('Fee must be between 0 and 2000 bps (20%)');
  setUpiConfig(next);
  return next;
}

const DEFAULT_CRYPTO_NETWORKS: CryptoNetworkConfig[] = [
  { asset: 'USDT', network: 'TRC20', depositEnabled: false, withdrawEnabled: false, minAmount: 5, maxAmount: 10_000, feeFlat: 1, confirmationsRequired: 19, maintenance: false, updatedBy: null, updatedAt: null },
  { asset: 'USDT', network: 'ERC20', depositEnabled: false, withdrawEnabled: false, minAmount: 10, maxAmount: 10_000, feeFlat: 5, confirmationsRequired: 12, maintenance: false, updatedBy: null, updatedAt: null },
];

export function getEffectiveCryptoConfigs(): CryptoNetworkConfig[] {
  const stored = listCryptoConfigs();
  if (stored.length > 0) return stored;
  return DEFAULT_CRYPTO_NETWORKS;
}

export class NetworkMismatchWarning extends Error {}

export function updateCryptoConfig(asset: string, network: string, patch: Partial<CryptoNetworkConfig>, admin: AdminAccount): CryptoNetworkConfig {
  const existing = getEffectiveCryptoConfigs().find((c) => c.asset === asset && c.network === network);
  const base: CryptoNetworkConfig = existing ?? { asset, network, depositEnabled: false, withdrawEnabled: false, minAmount: 1, maxAmount: 1000, feeFlat: 0, confirmationsRequired: 12, maintenance: false, updatedBy: null, updatedAt: null };
  const next: CryptoNetworkConfig = { ...base, ...patch, asset, network, updatedBy: admin.id, updatedAt: Date.now() };
  if (next.minAmount < 0 || next.maxAmount <= next.minAmount) throw new Error('Invalid min/max amount range');
  if (next.confirmationsRequired < 1 || next.confirmationsRequired > 200) throw new Error('confirmationsRequired out of range');
  // Different networks for the same asset are NOT interchangeable (e.g. sending TRC20 USDT
  // to an ERC20 address is an unrecoverable loss for a real user) — this is a config-time
  // warning surface, not a hard block, since an operator legitimately can configure both
  // independently; it exists so the admin UI can render the mismatch warning required by
  // the product spec rather than silently treating all "USDT" rows as one interchangeable
  // pool of funds.
  upsertCryptoConfig(next);
  return next;
}

/** Public-safe projection for the player-facing Payment Methods / Deposit screens — only
 *  what a player legitimately needs to decide which method to use (enabled? limits?
 *  network?), never an internal field (updatedBy, maintenance notes, fee basis points as
 *  raw internal units, etc). There are no secrets in the underlying config to begin with
 *  (no real provider is integrated — see this file's module doc-comment), but this keeps
 *  the player route from ever being able to leak a future field added here by accident. */
export interface PublicPaymentMethods {
  demoWallet: { available: true; note: string };
  upi: { enabled: boolean; minAmount: number; maxAmount: number } | null;
  crypto: Array<{ asset: string; network: string; depositEnabled: boolean; withdrawEnabled: boolean; minAmount: number; maxAmount: number; confirmationsRequired: number }>;
}

export function publicPaymentMethodsView(): PublicPaymentMethods {
  const upi = getEffectiveUpiConfig();
  const crypto = getEffectiveCryptoConfigs();
  return {
    demoWallet: { available: true, note: 'Instant demo-currency deposits/withdrawals — practice coins only, never real money.' },
    upi: upi.enabled ? { enabled: true, minAmount: upi.minAmount, maxAmount: upi.maxAmount } : { enabled: false, minAmount: upi.minAmount, maxAmount: upi.maxAmount },
    crypto: crypto.map((c) => ({
      asset: c.asset,
      network: c.network,
      depositEnabled: c.depositEnabled,
      withdrawEnabled: c.withdrawEnabled,
      minAmount: c.minAmount,
      maxAmount: c.maxAmount,
      confirmationsRequired: c.confirmationsRequired,
    })),
  };
}

export function networkMismatchWarnings(): string[] {
  const configs = getEffectiveCryptoConfigs();
  const byAsset = new Map<string, CryptoNetworkConfig[]>();
  for (const c of configs) byAsset.set(c.asset, [...(byAsset.get(c.asset) ?? []), c]);
  const warnings: string[] = [];
  for (const [asset, networks] of byAsset) {
    if (networks.length > 1) {
      warnings.push(`${asset} is configured across ${networks.length} networks (${networks.map((n) => n.network).join(', ')}) — these are NOT interchangeable; a deposit/withdrawal on the wrong network is an unrecoverable loss for the user.`);
    }
  }
  return warnings;
}

// --- Webhooks ------------------------------------------------------------------------
/** Real, structurally-ready event intake with idempotency-by-key duplicate detection.
 *  Genuinely empty today because no provider is wired up to actually call it — this is not
 *  a placeholder that fakes events, it's the real intake function a provider webhook route
 *  would call once one exists. */
export function ingestWebhookEvent(params: { provider: string; eventType: string; idempotencyKey: string; relatedTransactionId?: string | null }): WebhookEvent {
  const existing = findWebhookByIdempotencyKey(params.idempotencyKey);
  if (existing) {
    const duplicate: WebhookEvent = { ...existing, id: nanoid(12), status: 'duplicate_ignored', receivedAt: Date.now(), processedAt: Date.now() };
    appendWebhookEvent(duplicate);
    return duplicate;
  }
  const event: WebhookEvent = {
    id: nanoid(12),
    provider: params.provider,
    eventType: params.eventType,
    receivedAt: Date.now(),
    processedAt: null,
    status: 'received',
    retryCount: 0,
    errorReason: null,
    relatedTransactionId: params.relatedTransactionId ?? null,
    idempotencyKey: params.idempotencyKey,
  };
  appendWebhookEvent(event);
  return event;
}

export function allWebhookEvents(): WebhookEvent[] {
  return listWebhookEvents().slice().reverse();
}

export class WebhookRetryUnsafeError extends Error {}

/** Retrying a webhook is only ever safe for events that are still in a genuinely
 *  retryable state — never for one that already processed successfully (that would risk a
 *  duplicate financial effect) and never for a duplicate-ignored record (there is nothing
 *  to retry, the original already ran or is running). */
export function retryWebhookEvent(id: string): WebhookEvent {
  const event = listWebhookEvents().find((e) => e.id === id);
  if (!event) throw new Error('Webhook event not found');
  if (event.status === 'processed' || event.status === 'duplicate_ignored') {
    throw new WebhookRetryUnsafeError('Only a failed webhook event can be retried');
  }
  const updated = updateWebhookEvent(id, { status: 'processing', retryCount: event.retryCount + 1 });
  return updated!;
}

// --- Reconciliation ------------------------------------------------------------------
/** Compares the internal ledger against provider events. Honest by construction: with no
 *  real provider wired up, "provider events" is genuinely an empty set, so every deposit-
 *  type transaction in the internal ledger is correctly reported as MISSING a
 *  corresponding provider event rather than fabricated as MATCHED. This is what an
 *  operator actually needs to see — a true, not-yet-integrated state — instead of a
 *  reassuring-looking fake reconciliation. */
export function computeReconciliation() {
  const transactions = listAllTransactionsRaw();
  const events = listWebhookEvents();
  const depositLikeTypes = new Set(['topup']);
  const internalDeposits = transactions.filter((t) => depositLikeTypes.has(t.type));
  const matched = internalDeposits.filter((t) => events.some((e) => e.relatedTransactionId === t.id));
  const missingProviderEvent = internalDeposits.filter((t) => !events.some((e) => e.relatedTransactionId === t.id));
  const orphanEvents = events.filter((e) => e.relatedTransactionId && !transactions.some((t) => t.id === e.relatedTransactionId));
  return {
    matchedCount: matched.length,
    missingProviderEventCount: missingProviderEvent.length,
    orphanProviderEventCount: orphanEvents.length,
    duplicateEventCount: events.filter((e) => e.status === 'duplicate_ignored').length,
    note: 'No real payment provider is integrated yet — internal deposit transactions are demo/practice-currency wallet top-ups, not real-money deposits, so "missing provider event" here reflects that honestly rather than a real reconciliation gap against a live processor.',
  };
}
