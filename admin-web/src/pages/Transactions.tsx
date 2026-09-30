import { useState } from 'react';
import { usePolling } from '../hooks';
import { Badge, Empty, ErrorBox, Loading } from '../components/ui';
import { fmtCoin, fmtTime } from '../format';

interface TxRow {
  id: string;
  userId: string;
  type: string;
  amount: number;
  status: string;
  timestamp: number;
}
interface TxResult {
  rows: TxRow[];
  total: number;
  page: number;
  pageSize: number;
}

function statusTone(status: string) {
  if (status === 'completed') return 'green' as const;
  if (status === 'failed' || status === 'reversed') return 'red' as const;
  if (status === 'pending' || status === 'processing') return 'yellow' as const;
  return 'gray' as const;
}

export function TransactionsPage() {
  const [page, setPage] = useState(1);
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const pageSize = 30;
  const { data, error, loading } = usePolling<TxResult>(`/admin/transactions?page=${page}&pageSize=${pageSize}&type=${type}&status=${status}`, null, [page, type, status]);

  return (
    <div>
      <h1 className="admin-page-title">Transactions</h1>
      <p className="admin-page-sub">Every transaction ever recorded across every user, server-side paginated and filtered.</p>
      <div className="admin-toolbar">
        <select className="admin-select" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
          <option value="">All types</option>
          <option value="topup">Top-up</option>
          <option value="withdrawal">Withdrawal</option>
          <option value="entry_fee">Entry Fee</option>
          <option value="refund">Refund</option>
          <option value="payout">Payout</option>
          <option value="platform_fee">Platform Fee</option>
          <option value="signup_bonus">Signup Bonus</option>
          <option value="admin_adjustment">Admin Adjustment</option>
        </select>
        <select className="admin-select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          <option value="completed">Completed</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
          <option value="reversed">Reversed</option>
        </select>
      </div>
      {error && <ErrorBox message={error} />}
      {loading && !data && <Loading />}
      {data && data.rows.length === 0 && <Empty>No transactions match this filter.</Empty>}
      {data && data.rows.length > 0 && (
        <>
          <table className="admin-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>User</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Status</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((t) => (
                <tr key={t.id}>
                  <td>{t.id}</td>
                  <td>{t.userId}</td>
                  <td>{t.type}</td>
                  <td>{fmtCoin(t.amount)}</td>
                  <td>
                    <Badge tone={statusTone(t.status)}>{t.status}</Badge>
                  </td>
                  <td>{fmtTime(t.timestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="admin-pagination">
            <span>Page {data.page} · {data.total} total</span>
            <button className="admin-btn admin-btn--ghost admin-btn--sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Prev</button>
            <button className="admin-btn admin-btn--ghost admin-btn--sm" disabled={page * pageSize >= data.total} onClick={() => setPage((p) => p + 1)}>Next →</button>
          </div>
        </>
      )}
    </div>
  );
}
