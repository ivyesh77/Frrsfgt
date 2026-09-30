import { usePolling } from '../hooks';
import { Badge, ErrorBox, Loading } from '../components/ui';

interface Provider {
  name: string;
  method: string;
  enabled: boolean;
  environment: string;
  webhookConfigured: boolean;
  health: string;
  lastSuccessfulEventAt: number | null;
}

export function ProvidersPage() {
  const { data, error, loading } = usePolling<{ providers: Provider[]; note: string }>('/admin/payments/providers', 10000);
  return (
    <div>
      <h1 className="admin-page-title">Payment Providers</h1>
      <p className="admin-page-sub">Provider abstraction for UPI and Crypto. Secrets are never displayed here — see UPI/Crypto pages for operational configuration.</p>
      {error && <ErrorBox message={error} />}
      {loading && !data && <Loading />}
      {data && (
        <>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Method</th>
                <th>Enabled</th>
                <th>Environment</th>
                <th>Webhook</th>
                <th>Health</th>
              </tr>
            </thead>
            <tbody>
              {data.providers.map((p, i) => (
                <tr key={i}>
                  <td>{p.name}</td>
                  <td>{p.method}</td>
                  <td>
                    <Badge tone={p.enabled ? 'green' : 'gray'}>{p.enabled ? 'enabled' : 'disabled'}</Badge>
                  </td>
                  <td>{p.environment}</td>
                  <td>
                    <Badge tone={p.webhookConfigured ? 'green' : 'yellow'}>{p.webhookConfigured ? 'configured' : 'not configured'}</Badge>
                  </td>
                  <td>
                    <Badge tone={p.health === 'not_connected' ? 'yellow' : 'green'}>{p.health}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="admin-note">{data.note}</div>
        </>
      )}
    </div>
  );
}
