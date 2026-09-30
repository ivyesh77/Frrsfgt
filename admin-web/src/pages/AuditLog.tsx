import { useState } from 'react';
import { usePolling } from '../hooks';
import { Badge, Empty, ErrorBox, Loading } from '../components/ui';
import { fmtTime } from '../format';
import { api, ApiError, setBearerToken } from '../api';

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
  return (
    <div>
      <ChangePasswordPanel />
      <AuditTable title="My Activity" subtitle="Your own recent actions, for accountability." path="/admin/me/activity" />
    </div>
  );
}

function ChangePasswordPanel() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const canSubmit = currentPassword.length > 0 && newPassword.length >= 12 && newPassword === confirmPassword && !busy;

  async function submit() {
    setBusy(true);
    setErrorMsg(null);
    setSuccess(false);
    try {
      const res = await api.post<{ ok: true; token: string }>('/admin/auth/change-password', { currentPassword, newPassword });
      setBearerToken(res.token); // the server rotated every session for this admin, including this one — adopt the fresh token it just issued
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSuccess(true);
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : 'Failed to change password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-panel" style={{ marginBottom: 20 }}>
      <div className="admin-panel__title">Change your password</div>
      <p className="admin-page-sub" style={{ marginTop: -4 }}>
        Only you can change your own password — no admin, including a SUPER_ADMIN, can reset it for you. Requires your current password. Changing it signs out every other session
        for this account.
      </p>
      {success && (
        <div className="admin-error" style={{ borderColor: 'var(--green, #2d8a4e)', color: 'var(--green, #2d8a4e)' }}>
          Password changed. You're still signed in here; any other open sessions were signed out.
        </div>
      )}
      {errorMsg && <ErrorBox message={errorMsg} />}
      <div className="admin-toolbar">
        <input
          className="admin-input"
          type="password"
          placeholder="Current password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
        />
        <input
          className="admin-input"
          type="password"
          placeholder="New password (min 12 chars)"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
        />
        <input
          className="admin-input"
          type="password"
          placeholder="Confirm new password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
        />
      </div>
      {mismatch && <div style={{ color: 'var(--red, #c0392b)', fontSize: 12, marginBottom: 8 }}>Passwords don't match.</div>}
      <button className="admin-btn admin-btn--sm" disabled={!canSubmit} onClick={submit}>
        {busy ? 'Changing…' : 'Change password'}
      </button>
    </div>
  );
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
