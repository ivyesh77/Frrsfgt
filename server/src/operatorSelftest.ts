/**
 * HTTP-level self-test for the separate payment-operator surface.
 * Uses the real operator Express app and real payment store/ledger, while keeping
 * operator credentials and sessions entirely separate from player/admin auth.
 */
import type { Server } from 'node:http';
import { createOperatorApp } from './operator/server.js';
import { createOperatorAccount } from './operator/auth.js';
import { __resetOperatorStoreForTests } from './operator/store.js';
import { registerUser } from './wallet.js';
import { __resetStoreForTests, getUser } from './store.js';
import { __resetPaymentStoreForTests, getPaymentAdapter, updatePaymentAdapter } from './payments/store.js';
import { PaymentService } from './payments/service.js';
import { submitPaymentProof } from './payments/workflow.js';

process.env.PAYMENT_WEBHOOK_SECRET_PAY_01 = 'operator-selftest-secret';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (!condition) {
    failures += 1;
    console.error(`✗ FAIL: ${message}`);
  } else {
    console.log(`✓ ${message}`);
  }
}

async function json<T>(base: string, path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const response = await fetch(`${base}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  return { status: response.status, body: await response.json() as T };
}

async function main(): Promise<void> {
  __resetStoreForTests();
  __resetPaymentStoreForTests();
  __resetOperatorStoreForTests();
  updatePaymentAdapter('PAY-01', { status: 'ACTIVE', healthStatus: 'HEALTHY', depositEnabled: true, withdrawalEnabled: true, secretRef: 'PAYMENT_WEBHOOK_SECRET_PAY_01' });

  const player = await registerUser(`OperatorSelftest_${Date.now()}`, 'operator-player-password');
  const service = new PaymentService();
  const deposit = await service.createDeposit(player.id, { amount: 400, method: 'UPI', currency: 'INR', idempotencyKey: 'operator-selftest-deposit', requestId: 'operator-selftest-request' });
  const internalDeposit = (await import('./payments/store.js')).findPaymentByIdempotency(player.id, 'DEPOSIT', 'operator-selftest-deposit');
  if (!internalDeposit) throw new Error('Expected payment transaction to be persisted');
  submitPaymentProof(internalDeposit, { amount: 400, reference: 'UTR-OPERATOR-SELFTEST', paymentAt: Date.now() });
  const operatorOne = await createOperatorAccount('operator_selftest_one', 'OperatorSelftestOne!', 'test-admin', ['PAY-01']);
  await createOperatorAccount('operator_selftest_two', 'OperatorSelftestTwo!', 'test-admin', ['PAY-02']);

  const server = await new Promise<Server>((resolve) => {
    const listener = createOperatorApp().listen(0, '127.0.0.1', () => resolve(listener));
  });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const loginOne = await json<{ token: string }>(base, '/operator/auth/login', { method: 'POST', body: JSON.stringify({ name: 'operator_selftest_one', password: 'OperatorSelftestOne!' }) });
    assert(loginOne.status === 200 && !!loginOne.body.token, 'operator login succeeds through the separate operator API');
    const oneHeaders = { Authorization: `Bearer ${loginOne.body.token}` };
    const me = await json<{ operator: { id: string; assignedPaymentAccountIds: string[] } }>(base, '/operator/auth/me', { headers: oneHeaders });
    assert(me.status === 200 && me.body.operator.id === operatorOne.id && me.body.operator.assignedPaymentAccountIds.length === 1 && me.body.operator.assignedPaymentAccountIds[0] === 'PAY-01', 'operator session resolves only its assigned account set');
    const accounts = await json<{ accounts: Array<{ adapterId: string; secretConfigured?: boolean }> }>(base, '/operator/payment-accounts', { headers: oneHeaders });
    assert(accounts.status === 200 && accounts.body.accounts.length === 1 && accounts.body.accounts[0]?.adapterId === 'PAY-01', 'operator account list is assignment-scoped');
    assert(!JSON.stringify(accounts.body).includes('operator-selftest-secret'), 'provider secret material is absent from operator responses');

    const deposits = await json<{ rows: Array<{ id: string }> }>(base, '/operator/deposits', { headers: oneHeaders });
    assert(deposits.status === 200 && deposits.body.rows.some((row) => row.id === deposit.id), 'assigned deposit queue contains the real payment transaction');
    const detail = await json<{ transaction: { id: string; userId?: string } }>(base, `/operator/transactions/${deposit.id}`, { headers: oneHeaders });
    assert(detail.status === 200 && detail.body.transaction.id === deposit.id && detail.body.transaction.userId === undefined, 'operator transaction detail is available without exposing the player internal id');

    const loginTwo = await json<{ token: string }>(base, '/operator/auth/login', { method: 'POST', body: JSON.stringify({ name: 'operator_selftest_two', password: 'OperatorSelftestTwo!' }) });
    const twoHeaders = { Authorization: `Bearer ${loginTwo.body.token}` };
    const crossAccount = await json<{ error?: string }>(base, `/operator/transactions/${deposit.id}`, { headers: twoHeaders });
    assert(crossAccount.status === 404, 'an operator assigned to another payment account cannot read a transaction by forged id');
    const forgedAction = await json<{ error?: string }>(base, `/operator/transactions/${deposit.id}/verify`, { method: 'POST', headers: twoHeaders, body: JSON.stringify({ reason: 'forged cross-account action' }) });
    assert(forgedAction.status === 404, 'an operator assigned to another payment account cannot mutate a transaction by forged id');

    const verified = await json<{ ok: boolean; transaction: { status: string; workflowStatus?: string } }>(base, `/operator/transactions/${deposit.id}/verify`, { method: 'POST', headers: oneHeaders, body: JSON.stringify({ reason: 'UTR matched self-test evidence' }) });
    assert(verified.status === 200 && verified.body.ok && verified.body.transaction.status === 'COMPLETED' && verified.body.transaction.workflowStatus === 'VERIFIED', 'assigned operator verification settles the payment through the existing workflow');
    assert(getUser(player.id)?.walletBalance === 1400, 'operator settlement credits the existing player ledger exactly once');
    assert(getPaymentAdapter('PAY-01')?.pendingCount === 0, 'operator settlement decrements adapter pending count exactly once');
    const replay = await json<{ ok: boolean }>(base, `/operator/transactions/${deposit.id}/verify`, { method: 'POST', headers: oneHeaders, body: JSON.stringify({ reason: 'replayed verification request' }) });
    assert(replay.status === 200 && replay.body.ok && getUser(player.id)?.walletBalance === 1400 && getPaymentAdapter('PAY-01')?.pendingCount === 0, 'replayed operator verification is idempotent and does not double-credit or double-decrement metrics');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  if (failures > 0) {
    console.error(`OPERATOR SELF-TEST FAILED: ${failures} assertion(s)`);
    process.exitCode = 1;
    return;
  }
  console.log('ALL OPERATOR SELF-TESTS PASSED');
}

void main().catch((error) => {
  console.error('Operator self-test crashed:', error);
  process.exitCode = 1;
});
