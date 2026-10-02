import { Fragment, useState } from 'react';
import { api, ApiError } from '../api';
import { usePolling } from '../hooks';
import { Badge, ErrorBox, Loading } from '../components/ui';
import { useAuth } from '../AuthContext';

type Adapter = {
  adapterId: string; displayName: string; provider: string; method: string; currency: string; environment: string;
  status: string; depositEnabled: boolean; withdrawalEnabled: boolean; minAmount: number; maxAmount: number;
  dailyLimit: number; paymentExpirySeconds: number; upiId: string | null; qrReference: string | null;
  priority: number; routingWeight: number; capacity: number; healthStatus: string; pendingCount: number;
  successfulCount: number; failedCount: number; secretConfigured: boolean;
};

type EditValues = { minAmount: number; maxAmount: number; dailyLimit: number; paymentExpirySeconds: number; upiId: string; qrReference: string; priority: number; routingWeight: number; capacity: number };

function tone(status: string) { return status === 'ACTIVE' || status === 'HEALTHY' ? 'green' as const : status === 'DEGRADED' ? 'yellow' as const : 'gray' as const; }

export function PaymentAdaptersPage() {
  const { has } = useAuth();
  const { data, error, loading, reload } = usePolling<{ adapters: Adapter[]; slots: number }>('/admin/payment-adapters', 10000);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<EditValues>({ minAmount: 1, maxAmount: 100000, dailyLimit: 50000, paymentExpirySeconds: 600, upiId: '', qrReference: '', priority: 1, routingWeight: 1, capacity: 100 });
  const [newName, setNewName] = useState('');
  const [newMethod, setNewMethod] = useState<'UPI' | 'CRYPTO'>('UPI');
  const [newDailyLimit, setNewDailyLimit] = useState(50000);
  const [newExpiry, setNewExpiry] = useState(600);
  const [newUpiId, setNewUpiId] = useState('');
  const [newQrReference, setNewQrReference] = useState('');
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
    try {
      await api.post('/admin/payment-adapters', {
        displayName: newName, method: newMethod, currency: newMethod === 'UPI' ? 'INR' : 'USDT',
        dailyLimit: newDailyLimit, paymentExpirySeconds: newExpiry,
        upiId: newMethod === 'UPI' ? newUpiId : null, qrReference: newMethod === 'UPI' ? newQrReference : null,
        reason: 'New payment account added from operations console',
      });
      setNewName(''); setNewUpiId(''); setNewQrReference(''); reload();
    } catch (err) { setActionError(err instanceof ApiError ? err.message : 'Could not add payment account'); }
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
    setEditValues({ minAmount: adapter.minAmount, maxAmount: adapter.maxAmount, dailyLimit: adapter.dailyLimit ?? 50000, paymentExpirySeconds: adapter.paymentExpirySeconds ?? 600, upiId: adapter.upiId ?? '', qrReference: adapter.qrReference ?? '', priority: adapter.priority, routingWeight: adapter.routingWeight, capacity: adapter.capacity });
  }
  async function saveEdit(adapter: Adapter) {
    await update(adapter, { ...editValues, upiId: editValues.upiId.trim() || null, qrReference: editValues.qrReference.trim() || null });
    setEditing(null);
  }

  return <div>
    <h1 className="admin-page-title">Payment Accounts / Adapters</h1>
    <p className="admin-page-sub">Configure server-selected Payment IDs, safe player instructions, expiry and daily routing limits. Accounts are TEST/SANDBOX only in this build; archiving removes an account from new routing without deleting historical assignments.</p>
    {error && <ErrorBox message={error} />}{actionError && <ErrorBox message={actionError} />}{loading && !data && <Loading />}
    {has('PAYMENT_CONFIG') && <div className="admin-panel">
      <div className="admin-panel__title">Add payment account</div>
      <div className="admin-toolbar">
        <input className="admin-input" placeholder="Account display name" value={newName} onChange={(event) => setNewName(event.target.value)} />
        <select className="admin-input" value={newMethod} onChange={(event) => setNewMethod(event.target.value as 'UPI' | 'CRYPTO')}><option value="UPI">UPI · INR</option><option value="CRYPTO">Crypto · USDT TESTNET</option></select>
        <label>Daily limit <input className="admin-input" type="number" min="1" value={newDailyLimit} onChange={(event) => setNewDailyLimit(Number(event.target.value))} /></label>
        <label>Expiry seconds <input className="admin-input" type="number" min="60" max="86400" value={newExpiry} onChange={(event) => setNewExpiry(Number(event.target.value))} /></label>
      </div>
      {newMethod === 'UPI' && <div className="admin-toolbar" style={{ marginTop: 8 }}><input className="admin-input" placeholder="UPI ID shown to players (optional)" value={newUpiId} onChange={(event) => setNewUpiId(event.target.value)} /><input className="admin-input" placeholder="QR reference / managed asset ID (optional)" value={newQrReference} onChange={(event) => setNewQrReference(event.target.value)} /></div>}
      <div style={{ marginTop: 10 }}><button className="admin-btn admin-btn--primary" disabled={creating || newName.trim().length < 2} onClick={() => void createAccount()}>{creating ? 'Adding…' : 'Add account'}</button></div>
      <small>New accounts start disabled. Never enter provider passwords, bank login credentials, private keys or API secrets here.</small>
    </div>}
    {data && <table className="admin-table"><thead><tr><th>ID</th><th>Provider / Method</th><th>Environment</th><th>Status</th><th>Health</th><th>Limits / expiry</th><th>Load</th><th>Secrets</th><th>Actions</th></tr></thead><tbody>{data.adapters.map((adapter) => <Fragment key={adapter.adapterId}>
      <tr>
        <td><strong>{adapter.adapterId}</strong><br />{adapter.displayName}{adapter.method === 'UPI' && adapter.upiId && <><br /><small>UPI {adapter.upiId}</small></>}</td>
        <td>{adapter.provider} / {adapter.method} / {adapter.currency}</td>
        <td>{adapter.environment}</td>
        <td><Badge tone={tone(adapter.status)}>{adapter.status}</Badge><br /><small>deposit {adapter.depositEnabled ? 'on' : 'off'} · withdrawal {adapter.withdrawalEnabled ? 'on' : 'off'}</small></td>
        <td><Badge tone={tone(adapter.healthStatus)}>{adapter.healthStatus}</Badge></td>
        <td>{adapter.minAmount}–{adapter.maxAmount}<br />daily {adapter.dailyLimit ?? '—'} · {adapter.paymentExpirySeconds ?? 600}s<br />priority {adapter.priority} · weight {adapter.routingWeight}</td>
        <td>{adapter.pendingCount}/{adapter.capacity}</td>
        <td>{adapter.secretConfigured ? 'Configured' : 'Not configured'}</td>
        <td>{has('PAYMENT_CONFIG') && <><button disabled={busy === adapter.adapterId || adapter.status === 'ARCHIVED'} className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => void update(adapter, { status: adapter.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE', depositEnabled: adapter.status !== 'ACTIVE', withdrawalEnabled: adapter.status !== 'ACTIVE' })}>{adapter.status === 'ACTIVE' ? 'Disable' : 'Enable'}</button>{' '}<button disabled={adapter.status === 'ARCHIVED'} className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => beginEdit(adapter)}>Edit</button>{' '}<button disabled={busy === adapter.adapterId || adapter.status === 'ARCHIVED'} className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => void archive(adapter)}>Remove</button>{' '}</>}{has('PAYMENT_OPERATE') && <button disabled={busy === adapter.adapterId} className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => void health(adapter)}>Health</button>}</td>
      </tr>
      {editing === adapter.adapterId && <tr><td colSpan={9}><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}><label>Min <input type="number" value={editValues.minAmount} onChange={(event) => setEditValues((current) => ({ ...current, minAmount: Number(event.target.value) }))} /></label><label>Max <input type="number" value={editValues.maxAmount} onChange={(event) => setEditValues((current) => ({ ...current, maxAmount: Number(event.target.value) }))} /></label><label>Daily <input type="number" value={editValues.dailyLimit} onChange={(event) => setEditValues((current) => ({ ...current, dailyLimit: Number(event.target.value) }))} /></label><label>Expiry sec <input type="number" min="60" max="86400" value={editValues.paymentExpirySeconds} onChange={(event) => setEditValues((current) => ({ ...current, paymentExpirySeconds: Number(event.target.value) }))} /></label>{adapter.method === 'UPI' && <><label>UPI ID <input value={editValues.upiId} onChange={(event) => setEditValues((current) => ({ ...current, upiId: event.target.value }))} /></label><label>QR ref <input value={editValues.qrReference} onChange={(event) => setEditValues((current) => ({ ...current, qrReference: event.target.value }))} /></label></>}<label>Priority <input type="number" value={editValues.priority} onChange={(event) => setEditValues((current) => ({ ...current, priority: Number(event.target.value) }))} /></label><label>Weight <input type="number" value={editValues.routingWeight} onChange={(event) => setEditValues((current) => ({ ...current, routingWeight: Number(event.target.value) }))} /></label><label>Capacity <input type="number" value={editValues.capacity} onChange={(event) => setEditValues((current) => ({ ...current, capacity: Number(event.target.value) }))} /></label><button className="admin-btn admin-btn--primary admin-btn--sm" disabled={busy === adapter.adapterId} onClick={() => void saveEdit(adapter)}>Save</button><button className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => setEditing(null)}>Cancel</button></div></td></tr>}
    </Fragment>)}</tbody></table>}
  </div>;
}
