import { createHash } from 'node:crypto';
import type { PaymentAdapterConfig } from './types.js';

/**
 * Secrets are deployment concerns. Config stores only a reference such as
 * `PAYMENT_WEBHOOK_SECRET_PAY_01`; the value is resolved from the process environment and
 * never serialized to the payment store or returned by an admin API. A production deploy
 * should populate these variables from its secret manager, not commit them to a file.
 */
export function resolvePaymentSecret(adapter: PaymentAdapterConfig): string | null {
  if (!adapter.secretRef) return null;
  const value = process.env[adapter.secretRef];
  return value && value.length > 0 ? value : null;
}

export function paymentSecretConfigured(adapter: PaymentAdapterConfig): boolean {
  return resolvePaymentSecret(adapter) !== null;
}

export function secretFingerprint(secret: string | null): string | null {
  return secret ? createHash('sha256').update(secret).digest('hex').slice(0, 12) : null;
}
