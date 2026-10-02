import { adapterForProvider } from './adapters.js';
import { resolvePaymentSecret } from './secrets.js';
import { addReconciliation, getPaymentAdapter, listPaymentTransactions, listReconciliationRecords } from './store.js';
import type { PaymentTransactionStatus, ReconciliationRecord, ReconciliationStatus } from './types.js';

function providerToInternal(status: string): PaymentTransactionStatus | null {
  if (status === 'COMPLETED') return 'COMPLETED';
  if (status === 'FAILED') return 'FAILED';
  if (status === 'EXPIRED') return 'EXPIRED';
  if (status === 'REVERSED') return 'REVERSED';
  if (status === 'PROCESSING') return 'PROCESSING';
  if (status === 'PENDING') return 'PENDING';
  return null;
}

export async function reconcileTransaction(transactionId: string): Promise<ReconciliationRecord> {
  const transaction = listPaymentTransactions().find((entry) => entry.id === transactionId);
  if (!transaction) throw new Error('Payment transaction not found');
  if (!transaction.providerReference) {
    const record: ReconciliationRecord = { id: `RECON-${Date.now()}-${transaction.id}`, transactionId, provider: transaction.provider, internalStatus: transaction.status, providerStatus: null, status: 'UNKNOWN', detail: 'No provider reference exists yet', checkedAt: Date.now(), resolvedAt: null, resolvedBy: null };
    addReconciliation(record);
    return record;
  }
  const adapter = adapterForProvider(transaction.provider);
  const config = getPaymentAdapter(transaction.adapterId);
  if (!config) throw new Error('Assigned adapter not found');
  try {
    const providerResult = transaction.operation === 'DEPOSIT'
      ? await adapter.getDepositStatus(transaction.providerReference, { config, secret: resolvePaymentSecret(config) })
      : await adapter.getWithdrawalStatus(transaction.providerReference, { config, secret: resolvePaymentSecret(config) });
    const providerStatus = providerToInternal(providerResult.status);
    let status: ReconciliationStatus = 'MISMATCH';
    let detail = `Provider=${providerResult.status}; internal=${transaction.status}`;
    if ((transaction.status === 'PENDING' || transaction.status === 'PROCESSING') && Date.now() - transaction.createdAt > 15 * 60_000) {
      status = 'PENDING_TOO_LONG';
      detail = `Transaction has remained ${transaction.status} for more than 15 minutes`;
    } else if (providerStatus === transaction.status || (providerStatus === 'PENDING' && transaction.status === 'CREATED')) {
      status = 'MATCHED';
      detail = 'Provider and internal states agree';
    } else if (transaction.status === 'PENDING' || transaction.status === 'PROCESSING') {
      status = 'MISMATCH';
      detail = `Provider reports ${providerResult.status} while internal transaction is ${transaction.status}; no automatic settlement was applied`;
    }
    const record: ReconciliationRecord = { id: `RECON-${Date.now()}-${transaction.id}`, transactionId: transaction.id, provider: transaction.provider, internalStatus: transaction.status, providerStatus, status, detail, checkedAt: Date.now(), resolvedAt: null, resolvedBy: null };
    addReconciliation(record);
    return record;
  } catch (error) {
    const record: ReconciliationRecord = { id: `RECON-${Date.now()}-${transaction.id}`, transactionId: transaction.id, provider: transaction.provider, internalStatus: transaction.status, providerStatus: null, status: 'UNKNOWN', detail: error instanceof Error ? error.message : 'Provider status unavailable', checkedAt: Date.now(), resolvedAt: null, resolvedBy: null };
    addReconciliation(record);
    return record;
  }
}

export async function reconcileAllPending(): Promise<ReconciliationRecord[]> {
  const pending = listPaymentTransactions().filter((transaction) => ['CREATED', 'PENDING', 'PROCESSING'].includes(transaction.status));
  const records: ReconciliationRecord[] = [];
  for (const transaction of pending) records.push(await reconcileTransaction(transaction.id));
  return records;
}

export function reconciliationForTransaction(transactionId: string): ReconciliationRecord[] {
  return listReconciliationRecords(transactionId);
}
