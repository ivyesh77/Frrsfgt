import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import { usePolling } from '../hooks';
import { ErrorBox, Loading } from '../components/ui';
import { useAuth } from '../AuthContext';

type Config = { routingStrategy: 'ROUND_ROBIN' | 'WEIGHTED' | 'PRIORITY' | 'LEAST_LOAD' | 'CAPACITY_BASED'; allowPreCreationFailover: boolean; defaultCurrency: string; platformFeeBps: number; withdrawalFeeFlat: number; depositLimits: { minAmount: number; maxAmount: number; dailyLimit: number; monthlyLimit: number }; withdrawalLimits: { minAmount: number; maxAmount: number; dailyLimit: number; monthlyLimit: number }; version: number; };
export function PaymentConfigPage() {
  const { has } = useAuth();
  const { data, error, loading, reload } = usePolling<{ config: Config }>('/admin/payment-config', 15000);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  if (loading && !data) return <div><h1 className="admin-page-title">Payment Routing Configuration</h1><Loading /></div>;
  if (error) return <div><h1 className="admin-page-title">Payment Routing Configuration</h1><ErrorBox message={error} /></div>;
  if (!data) return null;
  const config = data.config;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setNotice(null); setActionError(null);
    const form = new FormData(event.currentTarget);
    const patch = { routingStrategy: String(form.get('routingStrategy')), allowPreCreationFailover: form.get('allowPreCreationFailover') === 'on', platformFeeBps: Number(form.get('platformFeeBps')), withdrawalFeeFlat: Number(form.get('withdrawalFeeFlat')), depositLimits: { ...config.depositLimits, minAmount: Number(form.get('depositMin')), maxAmount: Number(form.get('depositMax')), dailyLimit: Number(form.get('depositDaily')), monthlyLimit: Number(form.get('depositMonthly')) }, withdrawalLimits: { ...config.withdrawalLimits, minAmount: Number(form.get('withdrawMin')), maxAmount: Number(form.get('withdrawMax')), dailyLimit: Number(form.get('withdrawDaily')), monthlyLimit: Number(form.get('withdrawMonthly')) } };
    try { await api.put('/admin/payment-config', { patch, reason: 'Payment routing and limits change from operations console' }); setNotice('Payment configuration saved. New routing decisions will use the new version; existing transactions are unchanged.'); reload(); } catch (err) { setActionError(err instanceof ApiError ? err.message : 'Could not save payment configuration'); }
  }
  return <div><h1 className="admin-page-title">Payment Routing Configuration</h1><p className="admin-page-sub">Configuration version {config.version}. Historical routing decisions retain the version and adapter selected at creation time.</p>{actionError && <ErrorBox message={actionError} />}{notice && <div className="admin-note">{notice}</div>}{has('PAYMENT_CONFIG') ? <form className="admin-form" onSubmit={(event) => void save(event)}><label>Routing strategy<select name="routingStrategy" defaultValue={config.routingStrategy}><option>ROUND_ROBIN</option><option>WEIGHTED</option><option>PRIORITY</option><option>LEAST_LOAD</option><option>CAPACITY_BASED</option></select></label><label><input type="checkbox" name="allowPreCreationFailover" defaultChecked={config.allowPreCreationFailover} /> Allow failover before provider creation</label><label>Platform fee (basis points)<input name="platformFeeBps" type="number" min="0" max="2000" defaultValue={config.platformFeeBps} /></label><label>Withdrawal fee flat<input name="withdrawalFeeFlat" type="number" min="0" defaultValue={config.withdrawalFeeFlat} /></label><h3>Deposit limits</h3><LimitFields prefix="deposit" values={config.depositLimits} /><h3>Withdrawal limits</h3><LimitFields prefix="withdraw" values={config.withdrawalLimits} /><button className="admin-btn admin-btn--primary" type="submit">Save configuration</button></form> : <div className="admin-note">Your role can view this configuration but cannot change it.</div>}</div>;
}
function LimitFields({ prefix, values }: { prefix: string; values: { minAmount: number; maxAmount: number; dailyLimit: number; monthlyLimit: number } }) { return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(120px, 1fr))', gap: 8 }}><label>Min<input name={`${prefix}Min`} type="number" defaultValue={values.minAmount} /></label><label>Max<input name={`${prefix}Max`} type="number" defaultValue={values.maxAmount} /></label><label>Daily<input name={`${prefix}Daily`} type="number" defaultValue={values.dailyLimit} /></label><label>Monthly<input name={`${prefix}Monthly`} type="number" defaultValue={values.monthlyLimit} /></label></div>; }
