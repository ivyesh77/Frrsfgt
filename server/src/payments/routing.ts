import { nanoid } from 'nanoid';
import { getPaymentConfig, listPaymentAdapters, nextRoutingCursor, addRoutingDecision } from './store.js';
import { adapterEligible } from './registry.js';
import type { PaymentAdapterConfig, PaymentAdapterId, PaymentCurrency, PaymentMethod, PaymentOperation, RoutingDecision, RoutingStrategy } from './types.js';

export interface RoutingResult {
  adapter: PaymentAdapterConfig;
  decision: RoutingDecision;
}

function weightedPick(candidates: PaymentAdapterConfig[], cursor: number): PaymentAdapterConfig {
  const total = candidates.reduce((sum, candidate) => sum + Math.max(0, candidate.routingWeight), 0);
  if (total <= 0) return candidates[cursor % candidates.length]!;
  let offset = cursor % total;
  for (const candidate of candidates) {
    offset -= Math.max(0, candidate.routingWeight);
    if (offset < 0) return candidate;
  }
  return candidates[candidates.length - 1]!;
}

function chooseCandidate(candidates: PaymentAdapterConfig[], strategy: RoutingStrategy, cursorKey: string): { adapter: PaymentAdapterConfig; reason: string } {
  if (candidates.length === 0) throw new Error('No eligible payment adapter is available');
  if (strategy === 'PRIORITY') {
    const adapter = candidates.slice().sort((a, b) => a.priority - b.priority || a.adapterId.localeCompare(b.adapterId))[0]!;
    return { adapter, reason: `PRIORITY: priority=${adapter.priority}; ACTIVE; HEALTHY; LIMIT OK` };
  }
  if (strategy === 'LEAST_LOAD') {
    const adapter = candidates.slice().sort((a, b) => a.pendingCount / Math.max(a.capacity, 1) - b.pendingCount / Math.max(b.capacity, 1) || a.priority - b.priority)[0]!;
    return { adapter, reason: `LEAST_LOAD: pending=${adapter.pendingCount}/${adapter.capacity}; ACTIVE; HEALTHY; LIMIT OK` };
  }
  if (strategy === 'CAPACITY_BASED') {
    const adapter = candidates.slice().sort((a, b) => (b.capacity - b.pendingCount) - (a.capacity - a.pendingCount) || a.priority - b.priority)[0]!;
    return { adapter, reason: `CAPACITY_BASED: available=${adapter.capacity - adapter.pendingCount}; ACTIVE; HEALTHY; LIMIT OK` };
  }
  const cursor = nextRoutingCursor(cursorKey, strategy === 'WEIGHTED' ? Math.max(1, candidates.reduce((sum, candidate) => sum + Math.max(0, candidate.routingWeight), 0)) : candidates.length);
  const adapter = strategy === 'WEIGHTED' ? weightedPick(candidates, cursor) : candidates[cursor % candidates.length]!;
  return { adapter, reason: `${strategy}: selected by configured ${strategy.toLowerCase()} rotation; ACTIVE; HEALTHY; LIMIT OK` };
}

export function routePayment(params: { transactionId: string; operation: PaymentOperation; method: PaymentMethod; currency: PaymentCurrency; amount: number; strategy?: RoutingStrategy }): RoutingResult {
  const config = getPaymentConfig();
  const strategy = params.strategy ?? config.routingStrategy;
  const candidates = listPaymentAdapters().filter((adapter) => adapterEligible(adapter, params.operation, params.method, params.currency, params.amount).eligible);
  const selected = chooseCandidate(candidates, strategy, `${params.operation}:${params.method}:${params.currency}`);
  const decision: RoutingDecision = {
    id: `ROUTE-${nanoid(12)}`,
    transactionId: params.transactionId,
    adapterId: selected.adapter.adapterId,
    provider: selected.adapter.provider,
    routingStrategy: strategy,
    routingReason: selected.reason,
    selectedAt: Date.now(),
    configurationVersion: config.version,
  };
  addRoutingDecision(decision);
  return { adapter: selected.adapter, decision };
}

export function eligibleAdapterReasons(operation: PaymentOperation, method: PaymentMethod, currency: PaymentCurrency, amount: number): Array<{ adapterId: PaymentAdapterId; eligible: boolean; reason: string }> {
  return listPaymentAdapters().map((adapter) => ({ adapterId: adapter.adapterId, ...adapterEligible(adapter, operation, method, currency, amount) }));
}
