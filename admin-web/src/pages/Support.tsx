import { useState } from 'react';
import { api, ApiError } from '../api';
import { usePolling } from '../hooks';
import { Badge, Empty, ErrorBox, Loading } from '../components/ui';
import { fmtTime } from '../format';
import { useAuth } from '../AuthContext';

interface Ticket {
  id: string;
  userId: string;
  userName: string;
  subject: string;
  status: string;
  createdAt: number;
  updatedAt: number;
}

const STATUSES = ['open', 'in_progress', 'waiting', 'resolved', 'closed'];

export function SupportPage() {
  const { has } = useAuth();
  const { data, error, loading, reload } = usePolling<{ tickets: Ticket[] }>('/admin/support/tickets', 10000);
  const [userId, setUserId] = useState('');
  const [subject, setSubject] = useState('');
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setCreateError(null);
    try {
      await api.post('/admin/support/tickets', { userId, subject });
      setUserId('');
      setSubject('');
      reload();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : 'Failed to create ticket');
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: string, status: string) {
    await api.put(`/admin/support/tickets/${id}`, { status });
    reload();
  }

  return (
    <div>
      <h1 className="admin-page-title">Support Center</h1>
      <p className="admin-page-sub">Support agents get read access to a user's real history plus the ability to leave notes — no financial mutation permission is granted to this role.</p>
      {error && <ErrorBox message={error} />}
      {loading && !data && <Loading />}

      {has('support.edit') && (
        <div className="admin-panel">
          <div className="admin-panel__title">New ticket</div>
          <div className="admin-toolbar">
            <input className="admin-input" placeholder="User ID" value={userId} onChange={(e) => setUserId(e.target.value)} />
            <input className="admin-input" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} style={{ minWidth: 240 }} />
            <button className="admin-btn admin-btn--sm" disabled={busy || !userId || !subject} onClick={create}>
              Create
            </button>
          </div>
          {createError && <ErrorBox message={createError} />}
        </div>
      )}

      {data && data.tickets.length === 0 && <Empty>No support tickets yet.</Empty>}
      {data && data.tickets.length > 0 && (
        <table className="admin-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Subject</th>
              <th>Status</th>
              <th>Created</th>
              {has('support.edit') && <th>Update</th>}
            </tr>
          </thead>
          <tbody>
            {data.tickets.map((t) => (
              <tr key={t.id}>
                <td>{t.userName}</td>
                <td>{t.subject}</td>
                <td>
                  <Badge tone={t.status === 'resolved' || t.status === 'closed' ? 'green' : t.status === 'open' ? 'yellow' : 'gray'}>{t.status}</Badge>
                </td>
                <td>{fmtTime(t.createdAt)}</td>
                {has('support.edit') && (
                  <td>
                    <select className="admin-select" value={t.status} onChange={(e) => setStatus(t.id, e.target.value)}>
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
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
