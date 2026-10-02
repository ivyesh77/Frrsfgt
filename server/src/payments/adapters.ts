import { createHmac, timingSafeEqual } from 'node:crypto';
import { nanoid } from 'nanoid';
import type { CreatePaymentInput, PaymentAdapter, PaymentAdapterContext, PaymentProviderResult, PaymentCurrency, ProviderWebhookResult } from './types.js';

function mapStatus(status: string): PaymentProviderResult['status'] {
  if (status === 'COMPLETED') return 'COMPLETED';
  if (status === 'FAILED') return 'FAILED';
  if (status === 'PROCESSING') return 'PROCESSING';
  return 'PENDING';
}

function verifyHmac(rawBody: string, signature: string | undefined, secret: string | null): boolean {
  if (!signature || !secret) return false;
  const supplied = signature.startsWith('sha256=') ? signature.slice('sha256='.length) : signature;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const left = Buffer.from(supplied, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function parsePayload(rawBody: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(rawBody);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Webhook payload must be an object');
  return parsed as Record<string, unknown>;
}

function stringField(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Webhook field ${key} is required`);
  return value;
}

function numberField(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Webhook field ${key} must be numeric`);
  return value;
}

/** Deterministic local adapter. It never contacts a bank, UPI app, blockchain, or custodian.
 * It is deliberately limited to TEST/SANDBOX and exists only to exercise the full verified
 * transaction/webhook/ledger path without pretending that real money moved. */
export class SandboxPaymentAdapter implements PaymentAdapter {
  readonly provider = 'sandbox';
  readonly supportedMethods = ['UPI', 'CRYPTO'] as const;

  async createDeposit(input: CreatePaymentInput, context: PaymentAdapterContext): Promise<PaymentProviderResult> {
    this.assertEnabled(context);
    const providerReference = `SBX-D-${nanoid(16)}`;
    const expirySeconds = Number.isInteger(context.config.paymentExpirySeconds) ? context.config.paymentExpirySeconds : 600;
    return {
      providerReference,
      status: 'PENDING',
      providerFee: 0,
      networkFee: 0,
      instructions: input.method === 'UPI'
        ? { kind: 'SANDBOX', label: context.config.upiId ? 'UPI ID (sandbox)' : 'Sandbox payment reference', value: context.config.upiId ?? providerReference, expiresAt: Date.now() + expirySeconds * 1_000, safeMetadata: { method: 'UPI', simulation: true, ...(context.config.qrReference ? { qrReference: context.config.qrReference } : {}) } }
        : { kind: 'CRYPTO_ADDRESS', label: 'Sandbox address', value: `sandbox_${input.asset ?? 'USDT'}_${input.network ?? 'TESTNET'}_${nanoid(8)}`, expiresAt: Date.now() + expirySeconds * 1_000, safeMetadata: { asset: input.asset ?? 'USDT', network: input.network ?? 'TESTNET', simulation: true } },
    };
  }

  async getDepositStatus(reference: string, context: PaymentAdapterContext): Promise<PaymentProviderResult> {
    this.assertEnabled(context);
    return { providerReference: reference, status: 'PENDING', instructions: null, providerFee: 0, networkFee: 0 };
  }

  async createWithdrawal(input: CreatePaymentInput, context: PaymentAdapterContext): Promise<PaymentProviderResult> {
    this.assertEnabled(context);
    if (!input.destination) throw new Error('Withdrawal destination is required');
    return {
      providerReference: `SBX-W-${nanoid(16)}`,
      status: 'PROCESSING',
      providerFee: 0,
      networkFee: 0,
      instructions: { kind: 'SANDBOX', label: 'Sandbox payout reference', value: input.destination.slice(-4).padStart(4, '*'), expiresAt: null, safeMetadata: { simulation: true } },
    };
  }

  async getWithdrawalStatus(reference: string, context: PaymentAdapterContext): Promise<PaymentProviderResult> {
    this.assertEnabled(context);
    return { providerReference: reference, status: 'PROCESSING', instructions: null, providerFee: 0, networkFee: 0 };
  }

  verifyWebhook(rawBody: string, signature: string | undefined, context: PaymentAdapterContext): boolean {
    return this.assertEnvironment(context) && verifyHmac(rawBody, signature, context.secret);
  }

  parseWebhook(rawBody: string): ProviderWebhookResult {
    const payload = parsePayload(rawBody);
    const status = stringField(payload, 'status').toUpperCase();
    if (!['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED', 'REVERSED'].includes(status)) throw new Error('Unsupported webhook status');
    const currency = stringField(payload, 'currency').toUpperCase() as PaymentCurrency;
    if (currency !== 'INR' && currency !== 'USDT') throw new Error('Unsupported webhook currency');
    return {
      providerEventId: stringField(payload, 'providerEventId'),
      eventType: stringField(payload, 'eventType'),
      providerReference: stringField(payload, 'providerReference'),
      status: status as ProviderWebhookResult['status'],
      amount: numberField(payload, 'amount'),
      currency,
      transactionId: typeof payload.transactionId === 'string' ? payload.transactionId : undefined,
      txHash: typeof payload.txHash === 'string' ? payload.txHash : undefined,
      confirmations: typeof payload.confirmations === 'number' ? payload.confirmations : undefined,
    };
  }

  async healthCheck(context: PaymentAdapterContext): Promise<{ status: 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' | 'MAINTENANCE' | 'DISABLED'; detail: string }> {
    if (context.config.status === 'DISABLED' || context.config.status === 'ARCHIVED') return { status: 'DISABLED', detail: 'Adapter is disabled or archived' };
    if (!this.assertEnvironment(context)) return { status: 'UNAVAILABLE', detail: 'Sandbox adapter is not allowed in production' };
    return { status: 'HEALTHY', detail: 'Local sandbox adapter available; no real funds move' };
  }

  private assertEnabled(context: PaymentAdapterContext): void {
    if (!this.assertEnvironment(context)) throw new Error('Sandbox adapter is available only in TEST or SANDBOX environments');
    if (context.config.status !== 'ACTIVE') throw new Error('Payment adapter is not active');
  }

  private assertEnvironment(context: PaymentAdapterContext): boolean {
    return context.config.environment === 'TEST' || context.config.environment === 'SANDBOX';
  }
}

/** Explicitly unavailable until an official provider adapter is installed and configured.
 * Keeping this object in the registry prevents the payment service from hardcoding a
 * provider and makes an unconfigured production route fail closed. */
export class UnavailablePaymentAdapter implements PaymentAdapter {
  readonly provider: string;
  readonly supportedMethods: readonly [] = [];

  constructor(provider: string) {
    this.provider = provider;
  }

  async createDeposit(_input: CreatePaymentInput, _context: PaymentAdapterContext): Promise<PaymentProviderResult> { throw new Error(`Provider ${this.provider} is not configured`); }
  async getDepositStatus(_reference: string, _context: PaymentAdapterContext): Promise<PaymentProviderResult> { throw new Error(`Provider ${this.provider} is not configured`); }
  async createWithdrawal(_input: CreatePaymentInput, _context: PaymentAdapterContext): Promise<PaymentProviderResult> { throw new Error(`Provider ${this.provider} is not configured`); }
  async getWithdrawalStatus(_reference: string, _context: PaymentAdapterContext): Promise<PaymentProviderResult> { throw new Error(`Provider ${this.provider} is not configured`); }
  verifyWebhook(_rawBody: string, _signature: string | undefined, _context: PaymentAdapterContext): boolean { return false; }
  parseWebhook(_rawBody: string): ProviderWebhookResult { throw new Error(`Provider ${this.provider} is not configured`); }
  async healthCheck(_context: PaymentAdapterContext): Promise<{ status: 'UNAVAILABLE'; detail: string }> { return { status: 'UNAVAILABLE', detail: `Provider ${this.provider} has no installed official adapter` }; }
}

export class UPIProviderAdapter extends UnavailablePaymentAdapter {
  constructor() { super('official-upi'); }
}

export class CryptoProviderAdapter extends UnavailablePaymentAdapter {
  constructor() { super('official-crypto'); }
}

export function adapterForProvider(provider: string): PaymentAdapter {
  if (provider === 'sandbox') return new SandboxPaymentAdapter();
  if (provider === 'official-upi') return new UPIProviderAdapter();
  if (provider === 'official-crypto') return new CryptoProviderAdapter();
  return new UnavailablePaymentAdapter(provider);
}

export function providerStatusToPaymentStatus(status: PaymentProviderResult['status']): PaymentTransactionStatusLike {
  return mapStatus(status);
}

type PaymentTransactionStatusLike = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
