import { createHash } from 'node:crypto';
import { nanoid } from 'nanoid';
import { getUser } from '../store.js';
import { addPaymentAudit, addRiskSignal, addProviderEvent, decrementAdapterPending, findPaymentByIdempotency, findPaymentByProviderReference, findProviderEvent, getPaymentAdapter, getPaymentConfig, getPaymentTransaction, listPaymentTransactions, recordAdapterTransaction, updatePaymentTransaction, updateProviderEvent } from './store.js';
import { adapterForProvider } from './adapters.js';
import { resolvePaymentSecret } from './secrets.js';
import { routePayment } from './routing.js';
import { calculateFees, createPaymentTransaction, failWithdrawal, notifyPaymentTransition, reserveDepositlessWithdrawal, reversePayment, settleDeposit, settleWithdrawal, transitionPayment } from './transaction.js';
import { toPublicPaymentTransaction, type CreatePaymentInput, type PaymentAdapterConfig, type PaymentOperation, type PaymentProviderResult, type PaymentTransaction, type PaymentTransactionStatus, type PaymentMethod, type PaymentCurrency, type ProviderEvent, type ProviderWebhookResult } from './types.js';

const MAX_IDEMPOTENCY_LENGTH = 120;

function assertPaymentInput(input: CreatePaymentInput, operation: PaymentOperation): void {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new Error('Amount must be a positive whole currency unit');
  if (!['UPI', 'CRYPTO'].includes(input.method)) throw new Error('Unsupported payment method');
  if (!['INR', 'USDT'].includes(input.currency)) throw new Error('Unsupported payment currency');
  if (!input.idempotencyKey || input.idempotencyKey.length > MAX_IDEMPOTENCY_LENGTH) throw new Error('A valid idempotency key is required');
  if (operation === 'WITHDRAWAL' && (!input.destination || input.destination.length < 4 || input.destination.length > 180)) throw new Error('A valid withdrawal destination is required');
  if (input.method === 'CRYPTO' && (!input.asset || !input.network)) throw new Error('Crypto asset and network are required');
}

function maskDestination(destination: string | undefined): string | null {
  if (!destination) return null;
  if (destination.length <= 6) return '***';
  return `${destination.slice(0, 2)}***${destination.slice(-4)}`;
}

function statusFromProvider(result: PaymentProviderResult): PaymentTransactionStatus {
  if (result.status === 'COMPLETED') return 'COMPLETED';
  if (result.status === 'PROCESSING') return 'PROCESSING';
  if (result.status === 'FAILED') return 'FAILED';
  return 'PENDING';
}

function assertGlobalLimits(input: CreatePaymentInput, operation: PaymentOperation): void {
  const config = getPaymentConfig();
  const limits = operation === 'DEPOSIT' ? config.depositLimits : config.withdrawalLimits;
  if (input.amount < limits.minAmount || input.amount > limits.maxAmount) throw new Error(`${operation.toLowerCase()} amount is outside configured limits`);
  const now = Date.now();
  const dayStart = new Date(now).setHours(0, 0, 0, 0);
  const monthStart = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1).getTime();
  const usedToday = listPaymentTransactions({ userId: input.user.id, operation, from: dayStart }).filter((transaction) => !['FAILED', 'CANCELLED', 'EXPIRED', 'REVERSED'].includes(transaction.status)).reduce((sum, transaction) => sum + transaction.amount, 0);
  const usedMonth = listPaymentTransactions({ userId: input.user.id, operation, from: monthStart }).filter((transaction) => !['FAILED', 'CANCELLED', 'EXPIRED', 'REVERSED'].includes(transaction.status)).reduce((sum, transaction) => sum + transaction.amount, 0);
  if (usedToday + input.amount > limits.dailyLimit) throw new Error('Daily payment limit exceeded');
  if (usedMonth + input.amount > limits.monthlyLimit) throw new Error('Monthly payment limit exceeded');
}

function assertAdapterSpecificLimits(input: CreatePaymentInput, adapter: PaymentAdapterConfig): void {
  if (input.amount < adapter.minAmount || input.amount > adapter.maxAmount) throw new Error('Amount exceeds selected server-side adapter limits');
  if (adapter.method !== input.method || adapter.currency !== input.currency) throw new Error('Payment method or currency is not supported by the selected route');
  if (input.method === 'CRYPTO' && adapter.asset && adapter.asset !== input.asset) throw new Error('Unsupported crypto asset');
  if (input.method === 'CRYPTO' && adapter.network && adapter.network !== input.network) throw new Error('Unsupported crypto network');
}

function recordPlayerAudit(action: string, transactionId: string | null, userId: string, requestId: string, result: 'SUCCESS' | 'FAILURE', reason: string | null): void {
  addPaymentAudit({ id: `PAUD-${nanoid(12)}`, actorType: 'PLAYER', actorId: userId, action, targetType: 'payment_transaction', targetId: transactionId, reason, requestId, createdAt: Date.now(), result });
}

function maybeRaiseVelocitySignal(input: CreatePaymentInput, operation: PaymentOperation): void {
  const recent = listPaymentTransactions({ userId: input.user.id, operation, from: Date.now() - 10 * 60_000 });
  if (recent.length >= 5) {
    addRiskSignal({ id: `RISK-${nanoid(12)}`, userId: input.user.id, transactionId: null, severity: recent.length >= 10 ? 'HIGH' : 'MEDIUM', kind: 'PAYMENT_VELOCITY', detail: `High ${operation.toLowerCase()} creation velocity`, createdAt: Date.now(), evidence: { countLast10Minutes: recent.length, operation } });
  }
}

function buildInput(userId: string, body: { amount: number; method: PaymentMethod; currency: PaymentCurrency; idempotencyKey: string; destination?: string; asset?: string; network?: string; requestId: string }): CreatePaymentInput {
  const user = getUser(userId);
  if (!user) throw new Error('Authenticated player was not found');
  return { ...body, user };
}

export class PaymentService {
  async createDeposit(userId: string, body: { amount: number; method: PaymentMethod; currency: PaymentCurrency; idempotencyKey: string; asset?: string; network?: string; requestId: string }): Promise<ReturnType<typeof toPublicPaymentTransaction>> {
    const input = buildInput(userId, body);
    assertPaymentInput(input, 'DEPOSIT');
    const existing = findPaymentByIdempotency(userId, 'DEPOSIT', input.idempotencyKey);
    if (existing) {
      if (existing.amount !== input.amount || existing.method !== input.method || existing.currency !== input.currency) throw new Error('Idempotency key was already used with different payment parameters');
      return toPublicPaymentTransaction(existing);
    }
    assertGlobalLimits(input, 'DEPOSIT');
    maybeRaiseVelocitySignal(input, 'DEPOSIT');
    const transactionId = `TXN-${nanoid(12)}`;
    let route;
    try {
      route = routePayment({ transactionId, operation: 'DEPOSIT', method: input.method, currency: input.currency, amount: input.amount });
      assertAdapterSpecificLimits(input, route.adapter);
    } catch (error) {
      recordPlayerAudit('CREATE_DEPOSIT', null, userId, input.requestId, 'FAILURE', error instanceof Error ? error.message : 'No route');
      throw error;
    }
    const fees = calculateFees('DEPOSIT', input.amount, 0, 0, getPaymentConfig().platformFeeBps, 0);
    let transaction = createPaymentTransaction({ id: transactionId, userId, operation: 'DEPOSIT', method: input.method, currency: input.currency, amount: input.amount, fees, status: 'CREATED', adapterId: route.adapter.adapterId, provider: route.adapter.provider, environment: route.adapter.environment, clientIdempotencyKey: input.idempotencyKey, providerReference: null, destinationMasked: null, asset: input.asset ?? null, network: input.network ?? null, txHash: null, confirmations: null, instructions: null, failureReason: null, verifiedAt: null, correlationId: input.requestId });
    try {
      const result = await this.callDepositAdapter(input, route.adapter);
      const nextStatus = statusFromProvider(result);
      const updatedFees = calculateFees('DEPOSIT', input.amount, result.providerFee, result.networkFee, getPaymentConfig().platformFeeBps, 0);
      transaction = updatePaymentTransaction(transaction.id, { providerReference: result.providerReference, instructions: result.instructions, fees: updatedFees, failureReason: result.failureReason ?? null }) ?? transaction;
      recordAdapterTransaction(route.adapter.adapterId, nextStatus === 'FAILED' ? 'failure' : nextStatus === 'COMPLETED' ? 'success' : 'pending');
      if (nextStatus === 'COMPLETED') {
        transaction = transitionPayment(transaction, 'PENDING');
        transaction = settleDeposit(transaction);
      } else {
        transaction = transitionPayment(transaction, nextStatus, result.failureReason);
      }
      recordPlayerAudit('CREATE_DEPOSIT', transaction.id, userId, input.requestId, 'SUCCESS', null);
      return toPublicPaymentTransaction(transaction);
    } catch (error) {
      transaction = transitionPayment(transaction, 'FAILED', error instanceof Error ? error.message : 'Provider request failed');
      recordAdapterTransaction(route.adapter.adapterId, 'failure');
      recordPlayerAudit('CREATE_DEPOSIT', transaction.id, userId, input.requestId, 'FAILURE', transaction.failureReason);
      throw new Error(transaction.failureReason ?? 'Deposit provider request failed');
    }
  }

  async createWithdrawal(userId: string, body: { amount: number; method: PaymentMethod; currency: PaymentCurrency; idempotencyKey: string; destination: string; asset?: string; network?: string; requestId: string }): Promise<ReturnType<typeof toPublicPaymentTransaction>> {
    const input = buildInput(userId, body);
    assertPaymentInput(input, 'WITHDRAWAL');
    const existing = findPaymentByIdempotency(userId, 'WITHDRAWAL', input.idempotencyKey);
    if (existing) {
      if (existing.amount !== input.amount || existing.destinationMasked !== maskDestination(input.destination)) throw new Error('Idempotency key was already used with different withdrawal parameters');
      return toPublicPaymentTransaction(existing);
    }
    assertGlobalLimits(input, 'WITHDRAWAL');
    maybeRaiseVelocitySignal(input, 'WITHDRAWAL');
    const transactionId = `TXN-${nanoid(12)}`;
    const route = routePayment({ transactionId, operation: 'WITHDRAWAL', method: input.method, currency: input.currency, amount: input.amount });
    assertAdapterSpecificLimits(input, route.adapter);
    const fees = calculateFees('WITHDRAWAL', input.amount, 0, 0, getPaymentConfig().platformFeeBps, getPaymentConfig().withdrawalFeeFlat);
    let transaction = createPaymentTransaction({ id: transactionId, userId, operation: 'WITHDRAWAL', method: input.method, currency: input.currency, amount: input.amount, fees, status: 'CREATED', adapterId: route.adapter.adapterId, provider: route.adapter.provider, environment: route.adapter.environment, clientIdempotencyKey: input.idempotencyKey, providerReference: null, destinationMasked: maskDestination(input.destination), asset: input.asset ?? null, network: input.network ?? null, txHash: null, confirmations: null, instructions: null, failureReason: null, verifiedAt: null, correlationId: input.requestId });
    try {
      transaction = reserveDepositlessWithdrawal(transaction);
      const result = await this.callWithdrawalAdapter(input, route.adapter);
      const nextStatus = statusFromProvider(result);
      const updatedFees = calculateFees('WITHDRAWAL', input.amount, result.providerFee, result.networkFee, getPaymentConfig().platformFeeBps, getPaymentConfig().withdrawalFeeFlat);
      transaction = updatePaymentTransaction(transaction.id, { providerReference: result.providerReference, instructions: result.instructions, fees: updatedFees, failureReason: result.failureReason ?? null }) ?? transaction;
      recordAdapterTransaction(route.adapter.adapterId, nextStatus === 'FAILED' ? 'failure' : nextStatus === 'COMPLETED' ? 'success' : 'pending');
      if (nextStatus === 'COMPLETED') transaction = settleWithdrawal(transaction);
      else if (nextStatus === 'FAILED') transaction = failWithdrawal(transaction, 'FAILED', result.failureReason ?? 'Provider reported FAILED');
      else transaction = transitionPayment(transaction, nextStatus, result.failureReason);
      recordPlayerAudit('CREATE_WITHDRAWAL', transaction.id, userId, input.requestId, 'SUCCESS', null);
      return toPublicPaymentTransaction(transaction);
    } catch (error) {
      if (transaction.status === 'PENDING' || transaction.status === 'PROCESSING') {
        transaction = failWithdrawal(transaction, 'FAILED', error instanceof Error ? error.message : 'Provider request failed');
      } else if (transaction.status === 'CREATED') {
        transaction = transitionPayment(transaction, 'FAILED', error instanceof Error ? error.message : 'Provider request failed');
      }
      recordAdapterTransaction(route.adapter.adapterId, 'failure');
      recordPlayerAudit('CREATE_WITHDRAWAL', transaction.id, userId, input.requestId, 'FAILURE', transaction.failureReason);
      throw new Error(transaction.failureReason ?? 'Withdrawal provider request failed');
    }
  }

  async getPlayerTransaction(userId: string, id: string): Promise<ReturnType<typeof toPublicPaymentTransaction>> {
    const transaction = getPaymentTransaction(id);
    if (!transaction || transaction.userId !== userId) throw new Error('Payment transaction not found');
    return toPublicPaymentTransaction(transaction);
  }

  listPlayerTransactions(userId: string, operation?: PaymentOperation): ReturnType<typeof toPublicPaymentTransaction>[] {
    return listPaymentTransactions({ userId, operation }).sort((a, b) => b.createdAt - a.createdAt).map(toPublicPaymentTransaction);
  }

  private async callDepositAdapter(input: CreatePaymentInput, config: PaymentAdapterConfig): Promise<PaymentProviderResult> {
    const adapter = adapterForProvider(config.provider);
    return adapter.createDeposit(input, { config, secret: resolvePaymentSecret(config) });
  }

  private async callWithdrawalAdapter(input: CreatePaymentInput, config: PaymentAdapterConfig): Promise<PaymentProviderResult> {
    const adapter = adapterForProvider(config.provider);
    return adapter.createWithdrawal(input, { config, secret: resolvePaymentSecret(config) });
  }
}

export function isTerminalPaymentStatus(status: PaymentTransactionStatus): boolean {
  return ['COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED', 'REVERSED'].includes(status);
}

export function providerEventToRecord(provider: string, parsed: ProviderWebhookResult, rawBody: string, transactionId: string | null): ProviderEvent {
  return { id: `PEVT-${nanoid(12)}`, provider, providerEventId: parsed.providerEventId, eventType: parsed.eventType, receivedAt: Date.now(), processedAt: null, status: 'RECEIVED', retryCount: 0, error: null, transactionId, providerReference: parsed.providerReference, rawHash: createHash('sha256').update(rawBody).digest('hex') };
}

export function mapWebhookStatus(status: ProviderWebhookResult['status']): PaymentTransactionStatus {
  return status;
}

export function applyProviderUpdate(transaction: PaymentTransaction, parsed: ProviderWebhookResult): PaymentTransaction {
  if (parsed.amount !== transaction.amount || parsed.currency !== transaction.currency) throw new Error('Provider amount or currency does not match internal transaction');
  if (transaction.providerReference !== parsed.providerReference) throw new Error('Provider reference does not match internal transaction');
  const previous = transaction.status;
  let updated = transaction;
  if (parsed.status === 'COMPLETED') {
    updated = transaction.operation === 'DEPOSIT' ? settleDeposit(transaction) : settleWithdrawal(transaction);
  } else if (parsed.status === 'REVERSED') {
    updated = reversePayment(transaction);
  } else if (parsed.status === 'FAILED' || parsed.status === 'EXPIRED' || parsed.status === 'CANCELLED') {
    updated = transaction.operation === 'WITHDRAWAL' ? failWithdrawal(transaction, parsed.status, `Provider reported ${parsed.status}`) : transitionPayment(transaction, parsed.status, `Provider reported ${parsed.status}`);
  } else {
    updated = transitionPayment(transaction, parsed.status);
  }
  updated = updatePaymentTransaction(updated.id, { txHash: parsed.txHash ?? updated.txHash, confirmations: parsed.confirmations ?? updated.confirmations, verifiedAt: parsed.status === 'COMPLETED' ? Date.now() : updated.verifiedAt }) ?? updated;
  notifyPaymentTransition(updated, previous);
  return updated;
}

export function decrementPendingForTerminal(transaction: PaymentTransaction): void {
  if (isTerminalPaymentStatus(transaction.status)) decrementAdapterPending(transaction.adapterId);
}

export function providerConfigForTransaction(transaction: PaymentTransaction): PaymentAdapterConfig {
  const config = getPaymentAdapter(transaction.adapterId);
  if (!config) throw new Error('Assigned adapter no longer exists');
  return config;
}

export function providerTransaction(reference: string): PaymentTransaction {
  const transaction = findPaymentByProviderReference(reference);
  if (!transaction) throw new Error('Provider reference does not match a payment transaction');
  return transaction;
}

export function markProviderEventProcessed(event: ProviderEvent, transactionId: string | null): void {
  updateProviderEvent(event.id, { status: 'PROCESSED', processedAt: Date.now(), transactionId });
}

export function markProviderEventFailed(event: ProviderEvent, error: string): void {
  updateProviderEvent(event.id, { status: 'FAILED', processedAt: Date.now(), error, retryCount: event.retryCount + 1 });
}

export function existingProviderEvent(provider: string, eventId: string): ProviderEvent | undefined {
  return findProviderEvent(provider, eventId);
}

export { addProviderEvent };
