import { useState } from 'react';
import { api } from '../api';
import { usePolling } from '../hooks';
import { Badge, ConfirmActionModal, ErrorBox, Loading } from '../components/ui';
import { useAuth } from '../AuthContext';

interface MaintenanceState {
  scope: string;
  enabled: boolean;
  message: string;
}

const LABELS: Record<string, string> = {
  game: 'Game',
  matchmaking: 'Matchmaking',
  wallet: 'Wallet',
  deposit: 'Deposits',
  withdraw: 'Withdrawals',
  upi: 'UPI',
  crypto: 'Crypto',
  platform: 'Entire Platform',
};

export function MaintenancePage() {
  const { has } = useAuth();
  const { data, error, loading, reload } = usePolling<{ states: Record<string, MaintenanceState>; scopes: string[] }>('/admin/maintenance');
  const [pending, setPending] = useState<{ scope: string; enabled: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msgDraft, setMsgDraft] = useState('');

  async function apply(reason: string) {
    if (!pending) return;
    setBusy(true);
    try {
      await api.put(`/admin/maintenance/${pending.scope}`, { enabled: pending.enabled, message: msgDraft, reason });
      setPending(null);
      setMsgDraft('');
      reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="admin-page-title">Maintenance Control</h1>
      <p className="admin-page-sub">All changes are server-side — the player app cannot bypass a maintenance restriction regardless of client state.</p>
      {error && <ErrorBox message={error} />}
      {loading && !data && <Loading />}
      {data && (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Scope</th>
              <th>Status</th>
              <th>Message</th>
              {has('maintenance.edit') && <th>Action</th>}
            </tr>
          </thead>
          <tbody>
            {data.scopes.map((scope) => {
              const state = data.states[scope];
              return (
                <tr key={scope}>
                  <td>{LABELS[scope] ?? scope}</td>
                  <td>
                    <Badge tone={state?.enabled ? 'red' : 'green'}>{state?.enabled ? 'under maintenance' : 'normal'}</Badge>
                  </td>
                  <td>{state?.message || '—'}</td>
                  {has('maintenance.edit') && (
                    <td>
                      {!state?.enabled && (
                        <input
                          className="admin-input admin-btn--sm"
                          style={{ marginRight: 6, width: 180 }}
                          placeholder="User-facing message"
                          value={msgDraft}
                          onChange={(e) => setMsgDraft(e.target.value)}
                        />
                      )}
                      <button
                        className="admin-btn admin-btn--ghost admin-btn--sm"
                        onClick={() => setPending({ scope, enabled: !state?.enabled, message: msgDraft })}
                      >
                        {state?.enabled ? 'End maintenance' : 'Start maintenance'}
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {pending && (
        <ConfirmActionModal
          title={`${pending.enabled ? 'Start' : 'End'} maintenance for ${LABELS[pending.scope] ?? pending.scope}?`}
          description={pending.enabled ? `User-facing message: "${pending.message || '(none set)'}"` : undefined}
          danger={pending.enabled}
          busy={busy}
          onConfirm={apply}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
