import { useState } from 'react';
import { api, ApiError } from '../api';
import { usePolling } from '../hooks';
import { Badge, ErrorBox, Loading } from '../components/ui';
import { fmtTime } from '../format';
import { useAuth } from '../AuthContext';

interface RecordRow { id: string; transactionId: string; status: string; detail: string; checkedAt: number; }
function tone(status: string) { return status === 'MATCHED' ? 'green' as const : status === 'MISMATCH' || status === 'PENDING_TOO_LONG' ? 'red' as const : 'yellow' as const; }
export function PaymentReconciliationPage() {
  const { has } = useAuth();
  const { data, error, loading, reload } = usePolling<{ records: RecordRow[] }>('/admin/payment-reconciliation', 10000);
  const [actionError, setActionError] = useState<string | null>(null);
  async function run() { setActionError(null); try { await api.post('/admin/payment-reconciliation', { reason: 'Manual payment reconciliation from operations console' }); reload(); } catch (err) { setActionError(err instanceof ApiError ? err.message : 'Reconciliation failed'); } }
  return <div><h1 className="admin-page-title">Payment Reconciliation</h1><p className="admin-page-sub">Provider status is compared with internal payment state. Mismatches are surfaced; this action never silently credits or debits a wallet.</p>{error && <ErrorBox message={error} />}{actionError && <ErrorBox message={actionError} />}{loading && !data && <Loading />}{has('PAYMENT_RECONCILE') && <button className="admin-btn admin-btn--primary" onClick={() => void run()}>Run reconciliation</button>}{data && <table className="admin-table" style={{ marginTop: 16 }}><thead><tr><th>Transaction</th><th>Status</th><th>Detail</th><th>Checked</th></tr></thead><tbody>{data.records.map((record) => <tr key={record.id}><td>{record.transactionId}</td><td><Badge tone={tone(record.status)}>{record.status}</Badge></td><td>{record.detail}</td><td>{fmtTime(record.checkedAt)}</td></tr>)}</tbody></table>}</div>;
}
