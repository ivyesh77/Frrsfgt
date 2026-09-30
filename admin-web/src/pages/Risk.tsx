import { usePolling } from '../hooks';
import { Badge, Empty, ErrorBox, Loading } from '../components/ui';
import { fmtTime } from '../format';

interface RiskSignal {
  id: string;
  userId: string | null;
  userName: string | null;
  kind: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  detail: string;
  createdAt: number;
}

function severityTone(s: string) {
  if (s === 'critical') return 'red' as const;
  if (s === 'high') return 'red' as const;
  if (s === 'medium') return 'yellow' as const;
  return 'gray' as const;
}

export function RiskPage() {
  const { data, error, loading } = usePolling<{ signals: RiskSignal[] }>('/admin/risk', 15000);
  return (
    <div>
      <h1 className="admin-page-title">Fraud / Risk Signals</h1>
      <p className="admin-page-sub">
        Computed fresh from real server-recorded events (failed logins, reconnects, withdrawal frequency, etc.) on every request. These are signals for review, never automatic proof
        of wrongdoing — no account action is taken automatically.
      </p>
      {error && <ErrorBox message={error} />}
      {loading && !data && <Loading />}
      {data && data.signals.length === 0 && <Empty>No risk signals right now.</Empty>}
      {data && data.signals.length > 0 && (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Severity</th>
              <th>Kind</th>
              <th>User</th>
              <th>Detail</th>
              <th>Detected</th>
            </tr>
          </thead>
          <tbody>
            {data.signals.map((s) => (
              <tr key={s.id}>
                <td>
                  <Badge tone={severityTone(s.severity)}>{s.severity}</Badge>
                </td>
                <td>{s.kind}</td>
                <td>{s.userName ?? '—'}</td>
                <td>{s.detail}</td>
                <td>{fmtTime(s.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
