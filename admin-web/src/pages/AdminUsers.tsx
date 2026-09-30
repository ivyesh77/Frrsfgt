import { useState } from 'react';
import { api, ApiError } from '../api';
import { usePolling } from '../hooks';
import { ADMIN_ROLES, type AdminRole } from '../types';
import { Badge, ErrorBox, Loading } from '../components/ui';
import { useAuth } from '../AuthContext';

interface AdminAccount {
  id: string;
  name: string;
  role: AdminRole;
  active: boolean;
  lastLoginAt: number | null;
}

export function AdminUsersPage() {
  const { admin: me } = useAuth();
  const { data, error, loading, reload } = usePolling<{ admins: AdminAccount[] }>('/admin/admin-users');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<AdminRole>('READ_ONLY');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setCreateError(null);
    try {
      await api.post('/admin/admin-users', { name, password, role, reason });
      setName('');
      setPassword('');
      setReason('');
      reload();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : 'Failed to create admin account');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(a: AdminAccount) {
    await api.put(`/admin/admin-users/${a.id}`, { active: !a.active, reason: `Toggled active via admin panel by ${me?.name}` });
    reload();
  }

  return (
    <div>
      <h1 className="admin-page-title">Admin Users & Roles</h1>
      <p className="admin-page-sub">SUPER_ADMIN only. Every permission is enforced server-side against the ROLE_PERMISSIONS matrix — nothing here is client-editable.</p>
      {error && <ErrorBox message={error} />}
      {loading && !data && <Loading />}

      <div className="admin-panel">
        <div className="admin-panel__title">Create admin account</div>
        <div className="admin-toolbar">
          <input className="admin-input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input
            className="admin-input"
            type="password"
            placeholder="Password (min 12 chars)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
          <select className="admin-select" value={role} onChange={(e) => setRole(e.target.value as AdminRole)}>
            {ADMIN_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <input className="admin-input" style={{ width: '100%', marginBottom: 10 }} placeholder="Reason for creating this account" value={reason} onChange={(e) => setReason(e.target.value)} />
        <button className="admin-btn admin-btn--sm" disabled={busy || !name || password.length < 12 || !reason.trim()} onClick={create}>
          {busy ? 'Creating…' : 'Create admin'}
        </button>
        {createError && <ErrorBox message={createError} />}
      </div>

      {data && (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {data.admins.map((a) => (
              <tr key={a.id}>
                <td>{a.name}</td>
                <td>{a.role}</td>
                <td>
                  <Badge tone={a.active ? 'green' : 'gray'}>{a.active ? 'active' : 'deactivated'}</Badge>
                </td>
                <td>
                  {a.id !== me?.id && (
                    <button className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => toggleActive(a)}>
                      {a.active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
