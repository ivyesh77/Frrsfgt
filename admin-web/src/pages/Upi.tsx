import { useState } from 'react';
import { api, ApiError } from '../api';
import { usePolling } from '../hooks';
import { Badge, ErrorBox, Loading } from '../components/ui';
import { useAuth } from '../AuthContext';

interface UpiConfig {
  enabled: boolean;
  provider: string;
  environment: 'sandbox' | 'production';
  minAmount: number;
  maxAmount: number;
  feeBps: number;
  maintenance: boolean;
  webhookConfigured: boolean;
}

export function UpiPage() {
  const { has } = useAuth();
  const { data, error, loading, reload } = usePolling<{ config: UpiConfig }>('/admin/payments/upi');
  const [draft, setDraft] = useState<Partial<UpiConfig>>({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function save() {
    if (!reason.trim()) return;
    setBusy(true);
    setSaveError(null);
    try {
      await api.put('/admin/payments/upi', { patch: draft, reason: reason.trim() });
      setDraft({});
      setReason('');
      reload();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Failed to save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="admin-page-title">UPI Configuration</h1>
      <p className="admin-page-sub">No real UPI provider is integrated in this build — this configures what a real integration would read. Actual payment confirmation always comes from provider webhook verification, never from this screen.</p>
      {error && <ErrorBox message={error} />}
      {loading && !data && <Loading />}
      {data && (
        <div className="admin-panel">
          <dl className="admin-kv">
            <dt>Enabled</dt>
            <dd><Badge tone={data.config.enabled ? 'green' : 'gray'}>{String(data.config.enabled)}</Badge></dd>
            <dt>Environment</dt>
            <dd>{data.config.environment}</dd>
            <dt>Min amount</dt>
            <dd>🪙 {data.config.minAmount}</dd>
            <dt>Max amount</dt>
            <dd>🪙 {data.config.maxAmount}</dd>
            <dt>Fee (bps)</dt>
            <dd>{data.config.feeBps}</dd>
            <dt>Webhook configured</dt>
            <dd><Badge tone={data.config.webhookConfigured ? 'green' : 'yellow'}>{String(data.config.webhookConfigured)}</Badge></dd>
          </dl>

          {has('payments.edit') && (
            <>
              <div className="admin-toolbar" style={{ marginTop: 14 }}>
                <label>
                  <input type="checkbox" checked={draft.enabled ?? data.config.enabled} onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))} /> Enabled
                </label>
                <input className="admin-input" type="number" placeholder="Min amount" onChange={(e) => setDraft((d) => ({ ...d, minAmount: Number(e.target.value) }))} />
                <input className="admin-input" type="number" placeholder="Max amount" onChange={(e) => setDraft((d) => ({ ...d, maxAmount: Number(e.target.value) }))} />
                <input className="admin-input" type="number" placeholder="Fee (bps)" onChange={(e) => setDraft((d) => ({ ...d, feeBps: Number(e.target.value) }))} />
              </div>
              <input className="admin-input" style={{ width: '100%', marginTop: 10 }} placeholder="Reason for this change (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <button className="admin-btn admin-btn--sm" style={{ marginTop: 8 }} disabled={busy || !reason.trim()} onClick={save}>
                {busy ? 'Saving…' : 'Save'}
              </button>
              {saveError && <ErrorBox message={saveError} />}
            </>
          )}
        </div>
      )}
    </div>
  );
}
