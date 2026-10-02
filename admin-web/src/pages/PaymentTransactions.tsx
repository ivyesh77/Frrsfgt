import { useState } from 'react';
import { usePolling } from '../hooks';
import { Badge, ErrorBox, Loading } from '../components/ui';
import { fmtTime } from '../format';

interface Row { id: string; userId: string; operation: string; method: string; currency: string; amount: number; status: string; adapterId: string; provider: string; providerReference: string | null; createdAt: number; updatedAt: number; failureReason: string | null; }
interface Detail { transaction: Row & { fees: { totalFee: number; netAmount: number }; destinationMasked: string | null; instructions: unknown }; routing: { routingStrategy: string; routingReason: string; configurationVersion: number } | undefined; providerEvents: Array<{ providerEventId: string; status: string; eventType: string; receivedAt: number }>; reconciliation: Array<{ status: string; detail: string; checkedAt: number }>; }
function statusTone(status: string) { return status === 'COMPLETED' ? 'green' as const : status === 'FAILED' || status === 'REVERSED' ? 'red' as const : 'yellow' as const; }

export function PaymentTransactionsPage() {
  const [selected, setSelected] = useState<string | null>(null);
  const { data, error, loading } = usePolling<{ rows: Row[]; total: number }>('/admin/payment-transactions', 10000);
  const detail = usePolling<Detail>(selected ? `/admin/payment-transactions/${selected}` : '', null, [selected], Boolean(selected));
  return <div>
    <h1 className="admin-page-title">Payment Transactions</h1>
    <p className="admin-page-sub">Provider-facing transaction trace. Adapter assignment and routing decisions are immutable historical facts.</p>
    {error && <ErrorBox message={error} />}{loading && !data && <Loading />}
    {data && <table className="admin-table"><thead><tr><th>ID / User</th><th>Operation</th><th>Amount</th><th>Adapter</th><th>Status</th><th>Provider ref</th><th>Created</th></tr></thead><tbody>{data.rows.map((row) => <tr key={row.id} onClick={() => setSelected(row.id)} style={{ cursor: 'pointer' }}><td>{row.id}<br /><small>{row.userId}</small></td><td>{row.operation} · {row.method}</td><td>{row.currency} {row.amount}</td><td>{row.adapterId}<br />{row.provider}</td><td><Badge tone={statusTone(row.status)}>{row.status}</Badge>{row.failureReason && <small>{row.failureReason}</small>}</td><td>{row.providerReference ?? '—'}</td><td>{fmtTime(row.createdAt)}</td></tr>)}</tbody></table>}
    {selected && <section className="admin-note" style={{ marginTop: 20 }}>{detail.error && <ErrorBox message={detail.error} />}{detail.loading && <Loading />}{detail.data && <><h2>{detail.data.transaction.id}</h2><p><strong>Routing:</strong> {detail.data.routing?.routingStrategy} · {detail.data.routing?.routingReason} · config v{detail.data.routing?.configurationVersion}</p><p><strong>Fees:</strong> {detail.data.transaction.fees.totalFee} · net {detail.data.transaction.fees.netAmount} · ledger settlement {detail.data.transaction.status === 'COMPLETED' ? 'recorded in the wallet ledger' : 'not settled'}</p><p><strong>Provider events:</strong> {detail.data.providerEvents.length || 'none'}</p><p><strong>Reconciliation:</strong> {detail.data.reconciliation.map((record) => `${record.status}: ${record.detail}`).join(' | ') || 'not checked'}</p><button className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => setSelected(null)}>Close</button></>}</section>}
  </div>;
}
