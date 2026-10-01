import type { AdminAccount } from '../admin/types.js';
import { adapterForProvider } from './adapters.js';
import { paymentSecretConfigured, resolvePaymentSecret } from './secrets.js';
import { getPaymentAdapter, listPaymentAdapters, recordAdapterHealth, updatePaymentAdapter } from './store.js';
import type { AdapterHealthStatus, AdapterLifecycleStatus, PaymentAdapter, PaymentAdapterConfig, PaymentAdapterId, PaymentMethod, PaymentOperation, PaymentCurrency } from './types.js';

export interface PublicAdapterConfig extends Omit<PaymentAdapterConfig, 'secretRef'> {
  secretConfigured: boolean;
}

export function getAdapter(adapterId: PaymentAdapterId): { config: PaymentAdapterConfig; adapter: PaymentAdapter } {
  const config = getPaymentAdapter(adapterId);
  if (!config) throw new Error('Payment adapter not found');
  return { config, adapter: adapterForProvider(config.provider) };
}

export function publicAdapter(config: PaymentAdapterConfig): PublicAdapterConfig {
  const { secretRef: _secretRef, ...safe } = config;
  return { ...safe, secretConfigured: paymentSecretConfigured(config) };
}

export function listPublicAdapters(): PublicAdapterConfig[] {
  return listPaymentAdapters().map(publicAdapter);
}

export function configureAdapter(adapterId: PaymentAdapterId, patch: Partial<PaymentAdapterConfig>): PaymentAdapterConfig {
  const current = getPaymentAdapter(adapterId);
  if (!current) throw new Error('Payment adapter not found');
  if (current.status === 'ARCHIVED' && patch.status !== 'ARCHIVED') throw new Error('Archived adapter cannot be reactivated; create a new slot');
  if (patch.minAmount !== undefined && patch.minAmount < 0) throw new Error('Minimum amount cannot be negative');
  if (patch.maxAmount !== undefined && patch.maxAmount <= (patch.minAmount ?? current.minAmount)) throw new Error('Maximum amount must exceed minimum amount');
  if (patch.priority !== undefined && (!Number.isInteger(patch.priority) || patch.priority < 1)) throw new Error('Priority must be a positive integer');
  if (patch.routingWeight !== undefined && (!Number.isInteger(patch.routingWeight) || patch.routingWeight < 0)) throw new Error('Routing weight must be a non-negative integer');
  if (patch.capacity !== undefined && (!Number.isInteger(patch.capacity) || patch.capacity < 1)) throw new Error('Capacity must be a positive integer');
  if (patch.environment === 'PRODUCTION') {
    throw new Error('Production provider configuration is blocked until official adapter and compliance inputs are installed');
  }
  if (patch.status === 'ACTIVE' && patch.provider !== undefined && patch.provider !== 'sandbox') {
    throw new Error('Only the installed sandbox adapter may be activated in this build');
  }
  return updatePaymentAdapter(adapterId, patch) ?? current;
}

export function archiveAdapter(adapterId: PaymentAdapterId): PaymentAdapterConfig {
  const current = getPaymentAdapter(adapterId);
  if (!current) throw new Error('Payment adapter not found');
  return configureAdapter(adapterId, { status: 'ARCHIVED', depositEnabled: false, withdrawalEnabled: false, healthStatus: 'DISABLED' });
}

export async function healthCheckAdapter(adapterId: PaymentAdapterId): Promise<{ config: PaymentAdapterConfig; status: AdapterHealthStatus; detail: string }> {
  const { config, adapter } = getAdapter(adapterId);
  const result = await adapter.healthCheck({ config, secret: resolvePaymentSecret(config) });
  recordAdapterHealth(adapterId, { healthStatus: result.status, lastHealthCheckAt: Date.now(), healthDetail: result.detail });
  const next = getPaymentAdapter(adapterId) ?? config;
  return { config: next, status: result.status, detail: result.detail };
}

export function adapterEligible(config: PaymentAdapterConfig, operation: PaymentOperation, method: PaymentMethod, currency: PaymentCurrency, amount: number): { eligible: boolean; reason: string } {
  if (config.status !== 'ACTIVE') return { eligible: false, reason: `status=${config.status}` };
  if (config.method !== method) return { eligible: false, reason: `method=${config.method}` };
  if (config.currency !== currency) return { eligible: false, reason: `currency=${config.currency}` };
  if (operation === 'DEPOSIT' && !config.depositEnabled) return { eligible: false, reason: 'deposit-disabled' };
  if (operation === 'WITHDRAWAL' && !config.withdrawalEnabled) return { eligible: false, reason: 'withdrawal-disabled' };
  if (['UNAVAILABLE', 'MAINTENANCE', 'DISABLED'].includes(config.healthStatus)) return { eligible: false, reason: `health=${config.healthStatus}` };
  if (amount < config.minAmount || amount > config.maxAmount) return { eligible: false, reason: 'adapter-amount-limit' };
  if (config.capacity > 0 && config.pendingCount >= config.capacity) return { eligible: false, reason: 'capacity-exhausted' };
  return { eligible: true, reason: 'ACTIVE + HEALTHY + LIMIT OK' };
}

export function adapterSummary(config: PaymentAdapterConfig, admin?: AdminAccount): Record<string, unknown> {
  return { ...publicAdapter(config), canConfigure: admin ? admin.role === 'SUPER_ADMIN' || admin.role === 'ADMIN' || admin.role === 'PAYMENT_OPERATOR' : false };
}

export function listPaymentMethodsForPlayer(): Array<{ method: PaymentMethod; currency: PaymentCurrency; asset: string | null; network: string | null; depositEnabled: boolean; withdrawalEnabled: boolean; minAmount: number; maxAmount: number; environment: 'TEST' | 'SANDBOX' }> {
  return listPaymentAdapters()
    .filter((adapter) => adapter.status === 'ACTIVE' && adapter.healthStatus === 'HEALTHY' && adapter.provider === 'sandbox' && (adapter.depositEnabled || adapter.withdrawalEnabled))
    .map((adapter) => ({
      method: adapter.method,
      currency: adapter.currency,
      asset: adapter.asset ?? null,
      network: adapter.network ?? null,
      depositEnabled: adapter.depositEnabled,
      withdrawalEnabled: adapter.withdrawalEnabled,
      minAmount: adapter.minAmount,
      maxAmount: adapter.maxAmount,
      environment: adapter.environment === 'TEST' ? 'TEST' : 'SANDBOX',
    }));
}

export type { AdapterLifecycleStatus };
