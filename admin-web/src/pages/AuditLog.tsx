import { usePolling } from '../hooks';
import { Badge, Empty, ErrorBox, Loading } from '../components/ui';
import { fmtTime } from '../format';

interface AuditEntry {
  id: string;
  timestamp: number;
  adminName: string;
  role: string;
  action: string;
  targetKind: string;
  targetId: string | null;
  reason: string | null;
  result: 'success' | 'failure';
  errorMessage: string | null;
}

export function AuditLogPage() {
  return <AuditTable title="Audit Logs" subtitle="Every sensitive admin action, immutable and append-only. This view is never editable from the admin UI." path="/admin/audit" />;
}

export function MyActivityLog() {
  return <AuditTable title="My Activity" subtitle="Your own recent actions, for accountability." path="/admin/me/activity" />;
}

function AuditTable({ title, subtitle, path }: { title: string; subtitle: string; path: string }) {
  const { data, error, loading } = usePolling<{ rows: AuditEntry[] }>(path, 8000);
  return (
    <div>
      <h1 className="admin-page-title">{title}</h1>
      <p className="admin-page-sub">{subtitle}</p>
      {error && <ErrorBox message={error} />}
      {loading && !data && <Loading />}
      {data && data.rows.length === 0 && <Empty>No entries yet.</Empty>}
      {data && data.rows.length > 0 && (
        <table className="admin-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Admin</th>
              <th>Action</th>
              <th>Target</th>
              <th>Reason</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((e) => (
              <tr key={e.id}>
                <td>{fmtTime(e.timestamp)}</td>
                <td>
                  {e.adminName} <span style={{ color: 'var(--text-faint)' }}>({e.role})</span>
                </td>
                <td>{e.action}</td>
                <td>
                  {e.targetKind}
                  {e.targetId ? `:${e.targetId}` : ''}
                </td>
                <td>{e.reason ?? '—'}</td>
                <td>
                  <Badge tone={e.result === 'success' ? 'green' : 'red'}>{e.result}</Badge>
                  {e.errorMessage && <div style={{ color: 'var(--text-faint)', fontSize: 11 }}>{e.errorMessage}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
