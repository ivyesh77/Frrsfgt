import { useState } from 'react';
import { api, ApiError } from '../api';
import { usePolling } from '../hooks';
import { Badge, ErrorBox, Loading } from '../components/ui';
import { useAuth } from '../AuthContext';

interface CryptoNetworkConfig {
  asset: string;
  network: string;
  depositEnabled: boolean;
  withdrawEnabled: boolean;
  minAmount: number;
  maxAmount: number;
  confirmationsRequired: number;
}

export function CryptoPage() {
  const { has } = useAuth();
  const { data, error, loading, reload } = usePolling<{ networks: CryptoNetworkConfig[]; warnings: string[] }>('/admin/payments/crypto');
  const [actionError, setActionError] = useState<string | null>(null);

  async function toggleDeposit(n: CryptoNetworkConfig) {
    try {
      await api.put(`/admin/payments/crypto/${n.asset}/${n.network}`, { patch: { depositEnabled: !n.depositEnabled }, reason: `Toggled deposit ${!n.depositEnabled ? 'on' : 'off'} via admin panel` });
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to update');
    }
  }
  async function toggleWithdraw(n: CryptoNetworkConfig) {
    try {
      await api.put(`/admin/payments/crypto/${n.asset}/${n.network}`, { patch: { withdrawEnabled: !n.withdrawEnabled }, reason: `Toggled withdraw ${!n.withdrawEnabled ? 'on' : 'off'} via admin panel` });
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to update');
    }
  }

  return (
    <div>
      <h1 className="admin-page-title">Crypto Configuration</h1>
      <p className="admin-page-sub">No real crypto processor is integrated in this build. Different networks for the same asset are NOT interchangeable — see warnings below.</p>
      {error && <ErrorBox message={error} />}
      {actionError && <ErrorBox message={actionError} />}
      {loading && !data && <Loading />}
      {data && (
        <>
          {data.warnings.map((w, i) => (
            <div key={i} className="admin-error">⚠️ {w}</div>
          ))}
          <table className="admin-table">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Network</th>
                <th>Deposit</th>
                <th>Withdraw</th>
                <th>Min / Max</th>
                <th>Confirmations</th>
                {has('payments.edit') && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {data.networks.map((n) => (
                <tr key={`${n.asset}:${n.network}`}>
                  <td>{n.asset}</td>
                  <td>{n.network}</td>
                  <td><Badge tone={n.depositEnabled ? 'green' : 'gray'}>{n.depositEnabled ? 'on' : 'off'}</Badge></td>
                  <td><Badge tone={n.withdrawEnabled ? 'green' : 'gray'}>{n.withdrawEnabled ? 'on' : 'off'}</Badge></td>
                  <td>{n.minAmount} / {n.maxAmount}</td>
                  <td>{n.confirmationsRequired}</td>
                  {has('payments.edit') && (
                    <td style={{ display: 'flex', gap: 6 }}>
                      <button className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => toggleDeposit(n)}>Toggle deposit</button>
                      <button className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => toggleWithdraw(n)}>Toggle withdraw</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
