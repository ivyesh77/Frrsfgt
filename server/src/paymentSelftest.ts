import { createHmac } from 'node:crypto';
import { registerUser } from './wallet.js';
import { __resetStoreForTests, getUser } from './store.js';
import { __resetPaymentStoreForTests, getPaymentAdapter, updatePaymentAdapter } from './payments/store.js';
import { PaymentService } from './payments/service.js';
import { processProviderWebhook } from './payments/webhooks.js';
import { reconcileTransaction, resolveReconciliation } from './payments/reconciliation.js';

process.env.PAYMENT_WEBHOOK_SECRET_PAY_01 = 'payment-selftest-secret';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (!condition) {
    failures += 1;
    console.error(`✗ FAIL: ${message}`);
  } else {
    console.log(`✓ ${message}`);
  }
}

function signedWebhook(payload: Record<string, unknown>): { raw: string; signature: string } {
  const raw = JSON.stringify(payload);
  return { raw, signature: createHmac('sha256', process.env.PAYMENT_WEBHOOK_SECRET_PAY_01!).update(raw).digest('hex') };
}

async function main(): Promise<void> {
  __resetStoreForTests();
  __resetPaymentStoreForTests();
  updatePaymentAdapter('PAY-01', { status: 'ACTIVE', healthStatus: 'HEALTHY', depositEnabled: true, withdrawalEnabled: true, provider: 'sandbox', method: 'UPI', currency: 'INR', environment: 'TEST', secretRef: 'PAYMENT_WEBHOOK_SECRET_PAY_01', dailyLimit: 100_000, paymentExpirySeconds: 120, upiId: 'arena-selftest@upi', qrReference: 'qr-managed-test-01' });
  const user = await registerUser(`PaymentSelftest_${Date.now()}`, 'payment-test-password');
  const service = new PaymentService();

  const deposit = await service.createDeposit(user.id, { amount: 500, method: 'UPI', currency: 'INR', idempotencyKey: 'deposit-1', requestId: 'req-deposit-1' });
  assert(deposit.status === 'PENDING' && deposit.providerReference !== null, 'deposit starts pending with a provider reference and no wallet credit');
  assert(deposit.instructions?.value === 'arena-selftest@upi' && deposit.instructions.expiresAt !== null && deposit.instructions.expiresAt > Date.now() && deposit.instructions.safeMetadata.qrReference === 'qr-managed-test-01', 'server-selected account configuration produces safe UPI instructions with a server-defined expiry');
  assert(getUser(user.id)?.walletBalance === 1000, 'deposit creation does not credit the wallet');

  const completedDeposit = signedWebhook({ providerEventId: 'event-deposit-1', eventType: 'payment.succeeded', providerReference: deposit.providerReference, status: 'COMPLETED', amount: 500, currency: 'INR' });
  const depositWebhook = await processProviderWebhook('sandbox', completedDeposit.raw, completedDeposit.signature);
  assert(depositWebhook.accepted && depositWebhook.transaction?.status === 'COMPLETED', 'verified deposit webhook completes the payment transaction');
  assert(getUser(user.id)?.walletBalance === 1500, 'verified deposit credits the existing wallet ledger exactly once');
  const duplicateDeposit = await processProviderWebhook('sandbox', completedDeposit.raw, completedDeposit.signature);
  assert(duplicateDeposit.duplicate && getUser(user.id)?.walletBalance === 1500, 'duplicate deposit webhook is idempotent and does not double-credit');
  assert(getPaymentAdapter('PAY-01')?.pendingCount === 0, 'terminal deposit webhook decrements adapter pending count exactly once');
  const reconciliation = await reconcileTransaction(deposit.id);
  assert(reconciliation.status === 'MISMATCH' && reconciliation.resolution === null, 'reconciliation records a provider/internal mismatch without auto-settling');
  const resolvedReconciliation = resolveReconciliation(reconciliation.id, 'payment-selftest-admin', 'ACKNOWLEDGED', 'Provider sandbox status checked; no wallet mutation permitted');
  assert(resolvedReconciliation.resolution === 'ACKNOWLEDGED' && getUser(user.id)?.walletBalance === 1500, 'controlled reconciliation disposition is audited operational state only and leaves the wallet unchanged');

  const reversalDeposit = await service.createDeposit(user.id, { amount: 100, method: 'UPI', currency: 'INR', idempotencyKey: 'deposit-reversal-1', requestId: 'req-deposit-reversal-1' });
  const reversalCompletion = signedWebhook({ providerEventId: 'event-deposit-reversal-complete', eventType: 'payment.succeeded', providerReference: reversalDeposit.providerReference, status: 'COMPLETED', amount: 100, currency: 'INR' });
  await processProviderWebhook('sandbox', reversalCompletion.raw, reversalCompletion.signature);
  const reversal = signedWebhook({ providerEventId: 'event-deposit-reversal', eventType: 'payment.reversed', providerReference: reversalDeposit.providerReference, status: 'REVERSED', amount: 100, currency: 'INR' });
  const reversed = await processProviderWebhook('sandbox', reversal.raw, reversal.signature);
  assert(reversed.transaction?.status === 'REVERSED' && getUser(user.id)?.walletBalance === 1500, 'provider reversal reverses a completed deposit through the existing ledger');
  assert(getPaymentAdapter('PAY-01')?.pendingCount === 0, 'terminal reversal does not decrement adapter pending count a second time');

  const withdrawal = await service.createWithdrawal(user.id, { amount: 400, method: 'UPI', currency: 'INR', destination: 'player@upi', idempotencyKey: 'withdrawal-1', requestId: 'req-withdrawal-1' });
  assert(withdrawal.status === 'PROCESSING' && withdrawal.providerReference !== null, 'withdrawal reserves funds before provider processing');
  assert(getUser(user.id)?.walletBalance === 1100, 'withdrawal reservation reduces available wallet balance');
  const completedWithdrawal = signedWebhook({ providerEventId: 'event-withdrawal-1', eventType: 'payout.succeeded', providerReference: withdrawal.providerReference, status: 'COMPLETED', amount: 400, currency: 'INR' });
  await processProviderWebhook('sandbox', completedWithdrawal.raw, completedWithdrawal.signature);
  assert(getUser(user.id)?.walletBalance === 1100, 'completed withdrawal does not debit the wallet a second time');

  const failedWithdrawal = await service.createWithdrawal(user.id, { amount: 100, method: 'UPI', currency: 'INR', destination: 'player@upi', idempotencyKey: 'withdrawal-2', requestId: 'req-withdrawal-2' });
  assert(getUser(user.id)?.walletBalance === 1000, 'second withdrawal reserves another amount atomically');
  const failed = signedWebhook({ providerEventId: 'event-withdrawal-2', eventType: 'payout.failed', providerReference: failedWithdrawal.providerReference, status: 'FAILED', amount: 100, currency: 'INR' });
  await processProviderWebhook('sandbox', failed.raw, failed.signature);
  assert(getUser(user.id)?.walletBalance === 1100, 'failed withdrawal releases its reservation exactly once');

  const replay = await service.createWithdrawal(user.id, { amount: 100, method: 'UPI', currency: 'INR', destination: 'player@upi', idempotencyKey: 'withdrawal-2', requestId: 'req-withdrawal-2-retry' });
  assert(replay.id === failedWithdrawal.id && getUser(user.id)?.walletBalance === 1100, 'repeated withdrawal request returns the original transaction without another reservation');

  const forgedSignature = signedWebhook({ providerEventId: 'event-forged', eventType: 'payment.succeeded', providerReference: deposit.providerReference, status: 'COMPLETED', amount: 500, currency: 'INR' });
  let rejected = false;
  try {
    await processProviderWebhook('sandbox', forgedSignature.raw, 'not-a-valid-signature');
  } catch {
    rejected = true;
  }
  assert(rejected && getUser(user.id)?.walletBalance === 1100, 'invalid webhook signature is rejected without a wallet mutation');

  if (failures > 0) {
    console.error(`PAYMENT SELF-TEST FAILED: ${failures} assertion(s)`);
    process.exitCode = 1;
    return;
  }
  console.log('ALL PAYMENT SELF-TESTS PASSED');
}

void main();
