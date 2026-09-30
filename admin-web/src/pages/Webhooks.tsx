import { api, ApiError } from '../api';
import { usePolling } from '../hooks';
import { Badge, Empty, ErrorBox, Loading } from '../components/ui';
import { fmtTime } from '../format';
import { useAuth } from '../AuthContext';
import { useState } from 'react';

interface WebhookEvent {
  id: string;
  provider: string;
  eventType: string;
  receivedAt: number;
  status: string;
  retryCount: number;
  errorReason: string | null;
}

export function WebhooksPage() {
  const { has } = useAuth();
  const { data, error, loading, reload } = usePolling<{ events: WebhookEvent[]; note: string }>('/admin/webhooks', 10000);
  const [actionError, setActionError] = useState<string | null>(null);

  async function retry(id: string) {
    try {
      await api.post(`/admin/webhooks/${id}/retry`, { reason: 'Manual retry from admin panel' });
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Retry failed');
    }
  }

  return (
    <div>
      <h1 className="admin-page-title">Webhook Monitoring</h1>
      <p className="admin-page-sub">Real, structurally-ready event intake with idempotency-key duplicate detection.</p>
      {error && <ErrorBox message={error} />}
      {actionError && <ErrorBox message={actionError} />}
      {loading && !data && <Loading />}
      {data && data.events.length === 0 && <Empty>{data.note}</Empty>}
      {data && data.events.length > 0 && (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Provider</th>
              <th>Event</th>
              <th>Status</th>
              <th>Retries</th>
              <th>Received</th>
              {has('webhooks.retry') && <th>Action</th>}
            </tr>
          </thead>
          <tbody>
            {data.events.map((e) => (
              <tr key={e.id}>
                <td>{e.provider}</td>
                <td>{e.eventType}</td>
                <td>
                  <Badge tone={e.status === 'processed' ? 'green' : e.status === 'failed' ? 'red' : 'yellow'}>{e.status}</Badge>
                </td>
                <td>{e.retryCount}</td>
                <td>{fmtTime(e.receivedAt)}</td>
                {has('webhooks.retry') && (
                  <td>
                    {e.status === 'failed' && (
                      <button className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => retry(e.id)}>
                        Retry
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
