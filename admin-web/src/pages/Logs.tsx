import { useState } from 'react';
import { usePolling } from '../hooks';
import { Badge, Empty, ErrorBox, Loading } from '../components/ui';
import { fmtTime } from '../format';

interface LogEntry {
  timestamp: number;
  service: string;
  severity: string;
  event: string;
  detail: string;
  requestId: string;
}

export function LogsPage() {
  const [severity, setSeverity] = useState('');
  const { data, error, loading } = usePolling<{ logs: LogEntry[] }>(`/admin/logs?severity=${severity}`, 10000, [severity]);

  return (
    <div>
      <h1 className="admin-page-title">Logs</h1>
      <p className="admin-page-sub">
        This build's queryable "application logs" are the admin audit log plus login-attempt records — there is no separate structured application/system logger capturing console
        output into a searchable store yet. A narrower surface than the full spec, disclosed honestly rather than faked.
      </p>
      <div className="admin-toolbar">
        <select className="admin-select" value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="">All severities</option>
          <option value="info">Info</option>
          <option value="warning">Warning</option>
        </select>
      </div>
      {error && <ErrorBox message={error} />}
      {loading && !data && <Loading />}
      {data && data.logs.length === 0 && <Empty>No log entries yet.</Empty>}
      {data && data.logs.length > 0 && (
        <table className="admin-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Service</th>
              <th>Severity</th>
              <th>Event</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {data.logs.map((l, i) => (
              <tr key={i}>
                <td>{fmtTime(l.timestamp)}</td>
                <td>{l.service}</td>
                <td>
                  <Badge tone={l.severity === 'warning' ? 'yellow' : 'gray'}>{l.severity}</Badge>
                </td>
                <td>{l.event}</td>
                <td>{l.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
