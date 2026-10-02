import { nanoid } from 'nanoid';
import { decrementAdapterPending, findPaymentByAnyReference, getPaymentTransaction, recordAdapterTransaction, updatePaymentTransaction } from './store.js';
import { failWithdrawal, settleDeposit, settleWithdrawal, transitionPayment } from './transaction.js';
import type { PaymentProof, PaymentTransaction, PaymentWorkflowStatus } from './types.js';

const WORKFLOW_TRANSITIONS: Record<PaymentWorkflowStatus, readonly PaymentWorkflowStatus[]> = {
  AWAITING_PAYMENT: ['PAYMENT_SUBMITTED', 'EXPIRED', 'CANCELLED'],
  PAYMENT_SUBMITTED: ['AWAITING_VERIFICATION', 'UNDER_REVIEW', 'REJECTED', 'EXPIRED'],
  AWAITING_VERIFICATION: ['UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'EXPIRED'],
  UNDER_REVIEW: ['AWAITING_VERIFICATION', 'VERIFIED', 'REJECTED', 'EXPIRED'],
  VERIFIED: ['CONFIRMED', 'REJECTED'],
  REJECTED: [],
  EXPIRED: [],
  CANCELLED: [],
  PROCESSING: ['CONFIRMED', 'UNDER_REVIEW', 'REJECTED'],
  CONFIRMED: [],
};

function currentWorkflow(transaction: PaymentTransaction): PaymentWorkflowStatus {
  return transaction.workflowStatus ?? (transaction.status === 'COMPLETED' ? transaction.operation === 'DEPOSIT' ? 'VERIFIED' : 'CONFIRMED' : transaction.operation === 'DEPOSIT' ? 'AWAITING_PAYMENT' : 'PROCESSING');
}

export function transitionPaymentWorkflow(transaction: PaymentTransaction, status: PaymentWorkflowStatus): PaymentTransaction {
  const from = currentWorkflow(transaction);
  if (from !== status && !WORKFLOW_TRANSITIONS[from].includes(status)) throw new Error(`Illegal payment workflow transition ${from} -> ${status}`);
  return updatePaymentTransaction(transaction.id, { workflowStatus: status, workflowUpdatedAt: Date.now() }) ?? transaction;
}

export function submitPaymentProof(transaction: PaymentTransaction, proof: Omit<PaymentProof, 'submittedAt'>): PaymentTransaction {
  if (transaction.operation !== 'DEPOSIT') throw new Error('Payment proof is only supported for deposits');
  if (!Number.isSafeInteger(proof.amount) || proof.amount !== transaction.amount) throw new Error('Payment proof amount must match the payment request');
  if (!proof.reference || proof.reference.trim().length < 4 || proof.reference.trim().length > 120) throw new Error('A valid UTR/provider reference is required');
  if (transaction.proof) throw new Error('Payment proof has already been submitted for this transaction');
  if (!Number.isSafeInteger(proof.paymentAt) || proof.paymentAt > Date.now() + 5 * 60_000) throw new Error('Payment date is invalid');
  if (proof.evidenceReference && proof.evidenceReference.length > 240) throw new Error('Evidence reference is too long');
  const reference = proof.reference.trim();
  const existingReference = findPaymentByAnyReference(reference);
  if (existingReference && existingReference.id !== transaction.id) throw new Error('UTR/provider reference has already been used');
  const updated = updatePaymentTransaction(transaction.id, { proof: { ...proof, reference, submittedAt: Date.now() }, workflowStatus: 'AWAITING_VERIFICATION', workflowUpdatedAt: Date.now() });
  if (!updated) throw new Error('Payment transaction not found');
  return updated;
}

export function operatorRequestPaymentInfo(transaction: PaymentTransaction, reason: string): PaymentTransaction {
  if (!reason.trim()) throw new Error('A reason is required');
  if (['COMPLETED', 'REVERSED', 'FAILED', 'EXPIRED', 'CANCELLED'].includes(transaction.status)) throw new Error('Terminal payment cannot request more information');
  return transitionPaymentWorkflow(transaction, 'UNDER_REVIEW');
}

export function operatorRejectPayment(transaction: PaymentTransaction, reason: string): PaymentTransaction {
  if (!reason.trim()) throw new Error('A reason is required');
  if (transaction.status === 'COMPLETED' || transaction.status === 'REVERSED') throw new Error('Completed payment requires a provider reversal or admin reversal workflow');
  let updated = transaction;
  const wasOpen = transaction.status === 'PENDING' || transaction.status === 'PROCESSING';
  if (transaction.operation === 'WITHDRAWAL' && wasOpen) updated = failWithdrawal(transaction, 'FAILED', reason);
  else if (wasOpen) updated = transitionPayment(transaction, 'FAILED', reason);
  if (wasOpen) {
    decrementAdapterPending(transaction.adapterId);
    recordAdapterTransaction(transaction.adapterId, 'failure');
  }
  return updatePaymentTransaction(updated.id, { workflowStatus: 'REJECTED', workflowUpdatedAt: Date.now() }) ?? updated;
}

export function operatorVerifyDeposit(transaction: PaymentTransaction, reason: string): PaymentTransaction {
  if (!reason.trim()) throw new Error('A reason is required');
  if (transaction.operation !== 'DEPOSIT') throw new Error('Only deposits can be verified here');
  if (!transaction.proof) throw new Error('A payment proof reference is required before verification');
  let updated = transaction;
  const wasOpen = transaction.status === 'PENDING' || transaction.status === 'PROCESSING';
  if (wasOpen) updated = settleDeposit(transaction);
  else if (transaction.status !== 'COMPLETED') throw new Error(`Payment status ${transaction.status} cannot be verified`);
  if (wasOpen) {
    decrementAdapterPending(transaction.adapterId);
    recordAdapterTransaction(transaction.adapterId, 'success');
  }
  return updatePaymentTransaction(updated.id, { workflowStatus: 'VERIFIED', workflowUpdatedAt: Date.now(), verifiedAt: updated.verifiedAt ?? Date.now() }) ?? updated;
}

export function operatorProcessWithdrawal(transaction: PaymentTransaction, operatorReference: string, reason: string): PaymentTransaction {
  if (!reason.trim()) throw new Error('A reason is required');
  if (transaction.operation !== 'WITHDRAWAL') throw new Error('Only withdrawals can be processed here');
  if (!operatorReference || operatorReference.trim().length < 4 || operatorReference.trim().length > 120) throw new Error('A valid provider/transfer reference is required');
  if (transaction.status !== 'PENDING' && transaction.status !== 'PROCESSING') throw new Error(`Payment status ${transaction.status} cannot be processed`);
  const updated = transaction.status === 'PENDING' ? transitionPayment(transaction, 'PROCESSING') : transaction;
  return updatePaymentTransaction(updated.id, { providerReference: updated.providerReference ?? operatorReference.trim(), operatorReference: operatorReference.trim(), workflowStatus: 'PROCESSING', workflowUpdatedAt: Date.now() }) ?? updated;
}

export function operatorConfirmWithdrawal(transaction: PaymentTransaction, reason: string): PaymentTransaction {
  if (!reason.trim()) throw new Error('A reason is required');
  if (transaction.operation !== 'WITHDRAWAL') throw new Error('Only withdrawals can be confirmed here');
  if (transaction.environment === 'PRODUCTION') throw new Error('Production withdrawals require official provider confirmation');
  if (!transaction.operatorReference && !transaction.providerReference) throw new Error('A provider/transfer reference is required before confirmation');
  if (transaction.status !== 'PENDING' && transaction.status !== 'PROCESSING') throw new Error(`Payment status ${transaction.status} cannot be confirmed`);
  const updated = settleWithdrawal(transaction);
  decrementAdapterPending(transaction.adapterId);
  recordAdapterTransaction(transaction.adapterId, 'success');
  return updated;
}

export function newWorkflowRequestId(): string {
  return `WF-${nanoid(12)}`;
}

export function paymentTransactionOrThrow(id: string): PaymentTransaction {
  const transaction = getPaymentTransaction(id);
  if (!transaction) throw new Error('Payment transaction not found');
  return transaction;
}
