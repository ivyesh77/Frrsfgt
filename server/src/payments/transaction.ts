import { nanoid } from 'nanoid';
import { pushNotification } from '../notifications.js';
import { findLedgerTransactionByPayment } from '../store.js';
import { creditPaymentDeposit, completeWithdrawalReservation, releaseWithdrawalReservation, reserveWithdrawal, reverseCompletedWithdrawal, reversePaymentDeposit } from '../wallet.js';
import { addPaymentTransaction, updatePaymentTransaction } from './store.js';
import type { PaymentFeeBreakdown, PaymentOperation, PaymentTransaction, PaymentTransactionStatus } from './types.js';

const ALLOWED_TRANSITIONS: Record<PaymentTransactionStatus, readonly PaymentTransactionStatus[]> = {
  CREATED: ['PENDING', 'PROCESSING', 'FAILED', 'CANCELLED'],
  PENDING: ['PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED', 'REVERSED'],
  PROCESSING: ['COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED', 'REVERSED'],
  COMPLETED: ['REVERSED'],
  FAILED: [],
  EXPIRED: [],
  CANCELLED: [],
  REVERSED: [],
};

export function assertPaymentTransition(from: PaymentTransactionStatus, to: PaymentTransactionStatus): void {
  if (from === to) return;
  if (!ALLOWED_TRANSITIONS[from].includes(to)) throw new Error(`Illegal payment state transition ${from} -> ${to}`);
}

export function transitionPayment(transaction: PaymentTransaction, status: PaymentTransactionStatus, reason?: string): PaymentTransaction {
  assertPaymentTransition(transaction.status, status);
  return updatePaymentTransaction(transaction.id, { status, failureReason: reason ?? transaction.failureReason, completedAt: status === 'COMPLETED' ? Date.now() : transaction.completedAt }) ?? transaction;
}

export function calculateFees(operation: PaymentOperation, amount: number, providerFee: number, networkFee: number, platformFeeBps: number, withdrawalFeeFlat: number): PaymentFeeBreakdown {
  const platformFee = Math.round(amount * platformFeeBps / 10_000);
  const totalFee = providerFee + networkFee + platformFee + (operation === 'WITHDRAWAL' ? withdrawalFeeFlat : 0);
  return {
    providerFee,
    platformFee,
    networkFee: networkFee + (operation === 'WITHDRAWAL' ? withdrawalFeeFlat : 0),
    totalFee,
    netAmount: operation === 'DEPOSIT' ? amount - totalFee : amount,
  };
}

export function createPaymentTransaction(params: Omit<PaymentTransaction, 'id' | 'createdAt' | 'updatedAt' | 'completedAt' | 'ledgerTransactionIds'> & { id?: string }): PaymentTransaction {
  const now = Date.now();
  const transaction: PaymentTransaction = {
    ...params,
    id: params.id ?? `TXN-${nanoid(12)}`,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    workflowStatus: params.workflowStatus ?? (params.operation === 'DEPOSIT' ? 'AWAITING_PAYMENT' : 'PROCESSING'),
    workflowUpdatedAt: now,
    proof: params.proof ?? null,
    operatorReference: params.operatorReference ?? null,
    ledgerTransactionIds: [],
  };
  addPaymentTransaction(transaction);
  return transaction;
}

export function settleDeposit(transaction: PaymentTransaction): PaymentTransaction {
  if (transaction.status === 'COMPLETED') return transaction;
  if (transaction.operation !== 'DEPOSIT') throw new Error('Not a deposit transaction');
  creditPaymentDeposit(transaction.userId, transaction.fees.netAmount, transaction.id, transaction.currency, transaction.fees.totalFee, transaction.clientIdempotencyKey);
  const ledger = findLedgerTransactionByPayment(transaction.id, 'topup');
  const now = Date.now();
  const updated = transitionPayment(transaction, 'COMPLETED');
  return updatePaymentTransaction(updated.id, { ledgerTransactionIds: ledger ? [ledger.id] : [], verifiedAt: now, workflowStatus: 'VERIFIED', workflowUpdatedAt: now }) ?? updated;
}

export function reserveDepositlessWithdrawal(transaction: PaymentTransaction): PaymentTransaction {
  if (transaction.operation !== 'WITHDRAWAL') throw new Error('Not a withdrawal transaction');
  reserveWithdrawal(transaction.userId, transaction.amount + transaction.fees.totalFee, transaction.id, transaction.currency, transaction.fees.totalFee, transaction.clientIdempotencyKey);
  return transitionPayment(transaction, 'PENDING');
}

export function settleWithdrawal(transaction: PaymentTransaction): PaymentTransaction {
  if (transaction.operation !== 'WITHDRAWAL') throw new Error('Not a withdrawal transaction');
  completeWithdrawalReservation(transaction.id);
  const updated = transitionPayment(transaction, 'COMPLETED');
  return updatePaymentTransaction(updated.id, { workflowStatus: 'CONFIRMED', workflowUpdatedAt: Date.now() }) ?? updated;
}

export function failWithdrawal(transaction: PaymentTransaction, status: 'FAILED' | 'EXPIRED' | 'CANCELLED', reason: string): PaymentTransaction {
  if (transaction.operation !== 'WITHDRAWAL') throw new Error('Not a withdrawal transaction');
  if (transaction.status !== 'REVERSED' && transaction.status !== 'COMPLETED') {
    releaseWithdrawalReservation(transaction.id, transaction.currency, transaction.clientIdempotencyKey);
  }
  const updated = transitionPayment(transaction, status, reason);
  return updatePaymentTransaction(updated.id, { workflowStatus: status === 'FAILED' ? 'REJECTED' : status === 'EXPIRED' ? 'EXPIRED' : 'CANCELLED', workflowUpdatedAt: Date.now() }) ?? updated;
}

export function reversePayment(transaction: PaymentTransaction): PaymentTransaction {
  if (transaction.status !== 'COMPLETED') throw new Error('Only completed payments can be reversed');
  if (transaction.operation === 'DEPOSIT') reversePaymentDeposit(transaction.userId, transaction.fees.netAmount, transaction.id, transaction.currency);
  else reverseCompletedWithdrawal(transaction.id, transaction.currency);
  return transitionPayment(transaction, 'REVERSED', 'Provider reported REVERSED');
}

export function notifyPaymentTransition(transaction: PaymentTransaction, previous: PaymentTransactionStatus): void {
  if (previous === transaction.status) return;
  const title = `${transaction.operation === 'DEPOSIT' ? 'Deposit' : 'Withdrawal'} ${transaction.status.toLowerCase()}`;
  pushNotification(transaction.userId, 'payment', title, `${transaction.currency} ${transaction.amount} payment ${transaction.status.toLowerCase()}.`, { paymentTransactionId: transaction.id, status: transaction.status });
}
