import { useState } from 'react';
import { api } from '../api';
import { usePolling } from '../hooks';
import { Badge, ConfirmActionModal, ErrorBox, Loading } from '../components/ui';
import { fmtTime } from '../format';
import { useAuth } from '../AuthContext';

interface FeatureFlags {
  duelEnabled: boolean;
  squadEnabled: boolean;
  cryptoEnabled: boolean;
  upiEnabled: boolean;
  dailyModeEnabled: boolean;
  newGameUiEnabled: boolean;
}
interface FlagHistory {
  flag: string;
  previousValue: boolean;
  newValue: boolean;
  changedByName: string;
  changedAt: number;
}

const LABELS: Record<keyof FeatureFlags, string> = {
  duelEnabled: '1v1 Duel Enabled',
  squadEnabled: '1v1v1v1 Squad Enabled',
  cryptoEnabled: 'Crypto Payments Enabled',
  upiEnabled: 'UPI Payments Enabled',
  dailyModeEnabled: 'Daily Mode Enabled (not implemented)',
  newGameUiEnabled: 'New Game UI Enabled (not implemented)',
};

export function FlagsPage() {
  const { has } = useAuth();
  const { data, error, loading, reload } = usePolling<{ flags: FeatureFlags; history: FlagHistory[] }>('/admin/flags');
  const [pending, setPending] = useState<{ flag: keyof FeatureFlags; value: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function apply(reason: string) {
    if (!pending) return;
    setBusy(true);
    try {
      await api.put(`/admin/flags/${pending.flag}`, { value: pending.value, reason });
      setPending(null);
      reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="admin-page-title">Feature Flags</h1>
      <p className="admin-page-sub">Server-authoritative. Crypto/UPI are honestly off by default — no real payment provider is integrated in this build.</p>
      {error && <ErrorBox message={error} />}
      {loading && !data && <Loading />}
      {data && (
        <div className="admin-panel">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Flag</th>
                <th>State</th>
                {has('flags.edit') && <th>Action</th>}
              </tr>
            </thead>
            <tbody>
              {(Object.keys(LABELS) as Array<keyof FeatureFlags>).map((flag) => (
                <tr key={flag}>
                  <td>{LABELS[flag]}</td>
                  <td>
                    <Badge tone={data.flags[flag] ? 'green' : 'gray'}>{data.flags[flag] ? 'on' : 'off'}</Badge>
                  </td>
                  {has('flags.edit') && (
                    <td>
                      <button className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => setPending({ flag, value: !data.flags[flag] })}>
                        Turn {data.flags[flag] ? 'off' : 'on'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="admin-panel">
        <div className="admin-panel__title">Change history</div>
        {data && data.history.length === 0 && <p className="admin-empty">No flag changes yet.</p>}
        {data &&
          data.history.map((h, i) => (
            <div key={i} className="admin-note" style={{ marginBottom: 6 }}>
              {h.flag}: {String(h.previousValue)} → {String(h.newValue)} by {h.changedByName} at {fmtTime(h.changedAt)}
            </div>
          ))}
      </div>
      {pending && (
        <ConfirmActionModal
          title={`Turn ${pending.value ? 'on' : 'off'} ${LABELS[pending.flag]}?`}
          busy={busy}
          onConfirm={apply}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
