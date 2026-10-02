import { Fragment, useState } from 'react';
import { api, ApiError } from '../api';
import { usePolling } from '../hooks';
import { Badge, ErrorBox, Loading } from '../components/ui';
import { useAuth } from '../AuthContext';

type Adapter = { adapterId: string; displayName: string; provider: string; method: string; currency: string; environment: string; status: string; depositEnabled: boolean; withdrawalEnabled: boolean; minAmount: number; maxAmount: number; priority: number; routingWeight: number; capacity: number; healthStatus: string; pendingCount: number; successfulCount: number; failedCount: number; secretConfigured: boolean };

function tone(status: string) { return status === 'ACTIVE' || status === 'HEALTHY' ? 'green' as const : status === 'DEGRADED' ? 'yellow' as const : 'gray' as const; }

export function PaymentAdaptersPage() {
  const { has } = useAuth();
  const { data, error, loading, reload } = usePolling<{ adapters: Adapter[]; slots: number }>('/admin/payment-adapters', 10000);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValues, setEditValues] = useState({ minAmount: 1, maxAmount: 100000, priority: 1, routingWeight: 1, capacity: 100 });
  const [newName, setNewName] = useState('');
  const [newMethod, setNewMethod] = useState<'UPI' | 'CRYPTO'>('UPI');
  const [creating, setCreating] = useState(false);

  async function update(adapter: Adapter, patch: Record<string, unknown>) {
    setBusy(adapter.adapterId); setActionError(null);
    try { await api.put(`/admin/payment-adapters/${adapter.adapterId}`, { patch, reason: 'Payment account configuration change from operations console' }); reload(); }
    catch (err) { setActionError(err instanceof ApiError ? err.message : 'Adapter update failed'); }
    finally { setBusy(null); }
  }
  async function archive(adapter: Adapter) {
    setBusy(adapter.adapterId); setActionError(null);
    try { await api.post(`/admin/payment-adapters/${adapter.adapterId}/archive`, { reason: 'Payment account removed from new routing by operations console' }); reload(); }
    catch (err) { setActionError(err instanceof ApiError ? err.message : 'Could not remove payment account'); }
    finally { setBusy(null); }
  }
  async function createAccount() {
    setCreating(true); setActionError(null);
    try { await api.post('/admin/payment-adapters', { displayName: newName, method: newMethod, currency: newMethod === 'UPI' ? 'INR' : 'USDT', reason: 'New payment account added from operations console' }); setNewName(''); reload(); }
    catch (err) { setActionError(err instanceof ApiError ? err.message : 'Could not add payment account'); }
    finally { setCreating(false); }
  }
  async function health(adapter: Adapter) {
    setBusy(adapter.adapterId); setActionError(null);
    try { await api.post(`/admin/payment-adapters/${adapter.adapterId}/health-check`, { reason: 'Manual payment adapter health check' }); reload(); }
    catch (err) { setActionError(err instanceof ApiError ? err.message : 'Health check failed'); }
    finally { setBusy(null); }
  }
  function beginEdit(adapter: Adapter) {
    setEditing(adapter.adapterId);
    setEditValues({ minAmount: adapter.minAmount, maxAmount: adapter.maxAmount, priority: adapter.priority, routingWeight: adapter.routingWeight, capacity: adapter.capacity });
  }
  async function saveEdit(adapter: Adapter) { await update(adapter, editValues); setEditing(null); }

  return <div>
    <h1 className="admin-page-title">Payment Accounts / Adapters</h1>
    <p className="admin-page-sub">Add new TEST/SANDBOX payment accounts or remove them from new routing. Existing transaction routing remains permanent; removal archives the account instead of deleting history.</p>
    {error && <ErrorBox message={error} />}{actionError && <ErrorBox message={actionError} />}{loading && !data && <Loading />}
    {has('PAYMENT_CONFIG') && <div className="admin-panel"><div className="admin-panel__title">Add payment account</div><div className="admin-toolbar"><input className="admin-input" placeholder="Account display name" value={newName} onChange={(event) => setNewName(event.target.value)} /><select className="admin-input" value={newMethod} onChange={(event) => setNewMethod(event.target.value as 'UPI' | 'CRYPTO')}><option value="UPI">UPI · INR</option><option value="CRYPTO">Crypto · USDT TESTNET</option></select><button className="admin-btn admin-btn--primary" disabled={creating || newName.trim().length < 2} onClick={() => void createAccount()}>{creating ? 'Adding…' : 'Add account'}</button></div><small>New accounts start disabled and must be explicitly configured and health-checked before routing.</small></div>}
    {data && <table className="admin-table"><thead><tr><th>ID</th><th>Provider / Method</th><th>Environment</th><th>Status</th><th>Health</th><th>Limits</th><th>Load</th><th>Secrets</th><th>Actions</th></tr></thead><tbody>{data.adapters.map((adapter) => <Fragment key={adapter.adapterId}>
      <tr>
        <td><strong>{adapter.adapterId}</strong><br />{adapter.displayName}</td><td>{adapter.provider} / {adapter.method} / {adapter.currency}</td><td>{adapter.environment}</td><td><Badge tone={tone(adapter.status)}>{adapter.status}</Badge><br /><small>deposit {adapter.depositEnabled ? 'on' : 'off'} · withdrawal {adapter.withdrawalEnabled ? 'on' : 'off'}</small></td><td><Badge tone={tone(adapter.healthStatus)}>{adapter.healthStatus}</Badge></td><td>{adapter.minAmount}–{adapter.maxAmount}<br />priority {adapter.priority} · weight {adapter.routingWeight}</td><td>{adapter.pendingCount}/{adapter.capacity}</td><td>{adapter.secretConfigured ? 'Configured' : 'Not configured'}</td><td>{has('PAYMENT_CONFIG') && <><button disabled={busy === adapter.adapterId || adapter.status === 'ARCHIVED'} className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => void update(adapter, { status: adapter.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE', depositEnabled: adapter.status !== 'ACTIVE', withdrawalEnabled: adapter.status !== 'ACTIVE' })}>{adapter.status === 'ACTIVE' ? 'Disable' : 'Enable'}</button>{' '}<button disabled={adapter.status === 'ARCHIVED'} className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => beginEdit(adapter)}>Edit</button>{' '}<button disabled={busy === adapter.adapterId || adapter.status === 'ARCHIVED'} className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => void archive(adapter)}>Remove</button>{' '}</>}{has('PAYMENT_OPERATE') && <button disabled={busy === adapter.adapterId} className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => void health(adapter)}>Health</button>}</td>
      </tr>
      {editing === adapter.adapterId && <tr><td colSpan={9}><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}><label>Min <input type="number" value={editValues.minAmount} onChange={(event) => setEditValues((current) => ({ ...current, minAmount: Number(event.target.value) }))} /></label><label>Max <input type="number" value={editValues.maxAmount} onChange={(event) => setEditValues((current) => ({ ...current, maxAmount: Number(event.target.value) }))} /></label><label>Priority <input type="number" value={editValues.priority} onChange={(event) => setEditValues((current) => ({ ...current, priority: Number(event.target.value) }))} /></label><label>Weight <input type="number" value={editValues.routingWeight} onChange={(event) => setEditValues((current) => ({ ...current, routingWeight: Number(event.target.value) }))} /></label><label>Capacity <input type="number" value={editValues.capacity} onChange={(event) => setEditValues((current) => ({ ...current, capacity: Number(event.target.value) }))} /></label><button className="admin-btn admin-btn--primary admin-btn--sm" disabled={busy === adapter.adapterId} onClick={() => void saveEdit(adapter)}>Save</button><button className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => setEditing(null)}>Cancel</button></div></td></tr>}
    </Fragment>)}</tbody></table>}
  </div>;
}
