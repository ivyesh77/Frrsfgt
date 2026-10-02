import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from '../../components/common/Button';
import { createPaymentDeposit, createPaymentWithdrawal, fetchPaymentMethods, fetchPaymentTransactions, fetchWalletDetail, submitPaymentProof } from '../api';
import { sounds } from '../sound';
import { haptics } from '../haptics';
import { coinWalletId, TRANSACTION_LABELS, type ArenaUser, type PlayerPaymentTransaction, type PublicPaymentMethod, type PublicPaymentMethods, type Transaction } from '../types';

interface WalletScreenProps {
  user: ArenaUser;
  busy: boolean;
  onTopUp: (amount: number) => Promise<void> | void;
  onWithdraw: (amount: number) => Promise<void> | void;
}

type WalletTab = 'overview' | 'deposit' | 'withdraw' | 'methods' | 'transactions';
type DepositMethod = 'demo' | 'upi' | 'crypto';

const QUICK_AMOUNTS = [100, 500, 2000, 10000];

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function isCredit(type: Transaction['type']): boolean {
  return type === 'topup' || type === 'refund' || type === 'payout' || type === 'signup_bonus' || type === 'withdrawal_release';
}

function paymentStatusLabel(status: PlayerPaymentTransaction['status']): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

function paymentStatusClass(status: PlayerPaymentTransaction['status']): string {
  return status === 'COMPLETED' ? 'wallet-tx__amount--credit' : status === 'FAILED' || status === 'EXPIRED' || status === 'REVERSED' ? 'wallet-tx__amount--debit' : '';
}

function freshIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `payment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * The player payment surface is deliberately split from the legacy demo-wallet operation.
 * Demo Wallet still calls the existing practice ledger. UPI/Crypto calls the new payment
 * service, receives only safe instructions, and remains pending until a verified provider
 * webhook changes the server transaction and ledger. A button click never credits money.
 */
export function WalletScreen({ user, busy, onTopUp, onWithdraw }: WalletScreenProps) {
  const [tab, setTab] = useState<WalletTab>('overview');
  const [methods, setMethods] = useState<PublicPaymentMethods | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [paymentTransactions, setPaymentTransactions] = useState<PlayerPaymentTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<DepositMethod>('demo');
  const [amount, setAmount] = useState('');
  const [destination, setDestination] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    Promise.all([fetchPaymentMethods(), fetchWalletDetail(), fetchPaymentTransactions()])
      .then(([m, detail, paymentRows]) => {
        setMethods(m);
        setTransactions(detail.transactions);
        setPaymentTransactions(paymentRows);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Could not load wallet data'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload, user.walletBalance]);

  function switchTab(next: WalletTab) {
    sounds.click();
    setTab(next);
    setActionError(null);
    setActionNotice(null);
    setAmount('');
    setDestination('');
  }

  const amountNumber = Number(amount);
  const amountValid = amount.trim() !== '' && Number.isSafeInteger(amountNumber) && amountNumber > 0;
  const selectedRail = useMemo(() => {
    if (paymentMethod === 'demo') return null;
    const wanted = paymentMethod === 'upi' ? 'UPI' : 'CRYPTO';
    return methods?.methods?.find((method) => method.method === wanted && (tab === 'deposit' ? method.depositEnabled : method.withdrawalEnabled)) ?? null;
  }, [methods, paymentMethod, tab]);

  async function runAmount(kind: 'deposit' | 'withdraw', value: number) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      setActionError('Enter a positive whole amount');
      sounds.error();
      return;
    }
    if (kind === 'withdraw' && value > user.walletBalance) {
      setActionError('You cannot withdraw more than your available wallet balance');
      sounds.error();
      return;
    }
    if (kind === 'withdraw' && paymentMethod !== 'demo' && !destination.trim()) {
      setActionError('Enter the payout destination for this method');
      sounds.error();
      return;
    }
    setActionError(null);
    setActionNotice(null);
    setPending(true);
    try {
      if (paymentMethod === 'demo') {
        if (kind === 'deposit') await onTopUp(value);
        else await onWithdraw(value);
        sounds.walletSuccess();
        haptics.tap();
        setActionNotice(`${kind === 'deposit' ? 'Deposited' : 'Withdrew'} 🪙 ${value.toLocaleString()} practice coins successfully.`);
      } else {
        if (!selectedRail) throw new Error('This payment method is not currently enabled');
        const base = { amount: value, method: selectedRail.method, currency: selectedRail.currency, idempotencyKey: freshIdempotencyKey(), asset: selectedRail.asset ?? undefined, network: selectedRail.network ?? undefined } as const;
        const transaction = kind === 'deposit'
          ? await createPaymentDeposit(base)
          : await createPaymentWithdrawal({ ...base, destination: destination.trim() });
        setPaymentTransactions((current) => [transaction, ...current.filter((entry) => entry.id !== transaction.id)]);
        sounds.walletSuccess();
        haptics.tap();
        const instruction = transaction.instructions ? ` ${transaction.instructions.label}: ${transaction.instructions.value}.` : '';
        setActionNotice(`${kind === 'deposit' ? 'Deposit' : 'Withdrawal'} ${paymentStatusLabel(transaction.status).toLowerCase()}.${instruction} Wallet balance changes only after provider verification.`);
      }
      setAmount('');
      setDestination('');
      reload();
    } catch (err) {
      sounds.error();
      setActionError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="wallet-screen no-select">
      <header className="screen-header">
        <h1 className="arena-title arena-title--sm">Wallet</h1>
        <p className="arena-subtitle arena-subtitle--sm">Server-authoritative balance. Payment rails are TEST/SANDBOX only in this build.</p>
      </header>

      <section className="wallet-balance-card glass-panel">
        <span className="wallet-modal__label">Available balance</span>
        <span className="wallet-modal__balance">🪙 {user.walletBalance.toLocaleString()} ARC</span>
        <span className="wallet-modal__coin-id">{coinWalletId(user.id)}</span>
      </section>

      <nav className="wallet-tabs" role="tablist" aria-label="Wallet sections">
        {([
          ['overview', 'Overview'], ['deposit', 'Deposit'], ['withdraw', 'Withdraw'], ['methods', 'Payment Methods'], ['transactions', 'Transactions'],
        ] as Array<[WalletTab, string]>).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`wallet-modal__tab ${tab === id ? 'wallet-modal__tab--active' : ''}`} onClick={() => switchTab(id)}>{label}</button>
        ))}
      </nav>

      {loadError && <p className="arena-fineprint arena-fineprint--warn">{loadError}</p>}

      {tab === 'overview' && (
        <section className="wallet-overview">
          <p className="arena-fineprint">Demo Wallet is practice currency. TEST/SANDBOX deposits and withdrawals create real server payment transactions but never contact a bank, UPI network, blockchain, or custodian.</p>
          <div className="wallet-tx-list">
            {paymentTransactions.slice(0, 3).map((transaction) => <PaymentTxRow key={transaction.id} transaction={transaction} />)}
            {transactions.slice(0, 5).map((tx) => <TxRow key={tx.id} tx={tx} />)}
            {!loading && transactions.length === 0 && paymentTransactions.length === 0 && <p className="arena-empty">No transactions yet.</p>}
          </div>
        </section>
      )}

      {tab === 'deposit' && (
        <PaymentFormSection kind="deposit" method={paymentMethod} setMethod={setPaymentMethod} methods={methods} selectedRail={selectedRail} amount={amount} setAmount={setAmount} destination={destination} setDestination={setDestination} amountValid={amountValid} busy={busy || pending} onQuick={(value) => void runAmount('deposit', value)} onSubmit={() => void runAmount('deposit', amountNumber)} />
      )}
      {tab === 'withdraw' && (
        <PaymentFormSection kind="withdraw" method={paymentMethod} setMethod={setPaymentMethod} methods={methods} selectedRail={selectedRail} amount={amount} setAmount={setAmount} destination={destination} setDestination={setDestination} amountValid={amountValid} walletBalance={user.walletBalance} busy={busy || pending} onQuick={(value) => void runAmount('withdraw', value)} onSubmit={() => void runAmount('withdraw', amountNumber)} />
      )}

      {(actionError || actionNotice) && <p className={`arena-fineprint ${actionError ? 'arena-fineprint--warn' : ''}`} role={actionError ? 'alert' : 'status'}>{actionError ?? actionNotice}</p>}
      {tab === 'methods' && <PaymentMethodsPanel methods={methods} loading={loading} />}
      {tab === 'transactions' && <section className="wallet-transactions"><h2 className="arena-title arena-title--sm">Payment lifecycle</h2>{loading && <p className="arena-empty">Loading…</p>}{!loading && paymentTransactions.length === 0 && <p className="arena-empty">No provider transactions yet.</p>}{paymentTransactions.map((transaction) => <PaymentTxRow key={transaction.id} transaction={transaction} />)}<h2 className="arena-title arena-title--sm">Wallet ledger</h2>{transactions.map((tx) => <TxRow key={tx.id} tx={tx} />)}</section>}
    </div>
  );
}

function methodLabel(method: DepositMethod): string { return method === 'demo' ? 'Demo Wallet' : method === 'upi' ? 'UPI' : 'Crypto'; }

interface PaymentFormProps {
  kind: 'deposit' | 'withdraw';
  method: DepositMethod;
  setMethod: (method: DepositMethod) => void;
  methods: PublicPaymentMethods | null;
  selectedRail: PublicPaymentMethod | null;
  amount: string;
  setAmount: (value: string) => void;
  destination: string;
  setDestination: (value: string) => void;
  amountValid: boolean;
  walletBalance?: number;
  busy: boolean;
  onQuick: (amount: number) => void;
  onSubmit: () => void;
}

function PaymentFormSection({ kind, method, setMethod, methods, selectedRail, amount, setAmount, destination, setDestination, amountValid, walletBalance, busy, onQuick, onSubmit }: PaymentFormProps) {
  const enabled = method === 'demo' || selectedRail !== null;
  return <section className="wallet-deposit">
    <div className="wallet-method-picker" role="tablist" aria-label="Payment method">
      <MethodChip label="🪙 Demo Wallet" enabled active={method === 'demo'} onClick={() => setMethod('demo')} />
      <MethodChip label="📲 UPI" enabled={Boolean(methods?.methods?.some((entry) => entry.method === 'UPI' && (kind === 'deposit' ? entry.depositEnabled : entry.withdrawalEnabled)))} active={method === 'upi'} onClick={() => setMethod('upi')} />
      <MethodChip label="₿ Crypto" enabled={Boolean(methods?.methods?.some((entry) => entry.method === 'CRYPTO' && (kind === 'deposit' ? entry.depositEnabled : entry.withdrawalEnabled)))} active={method === 'crypto'} onClick={() => setMethod('crypto')} />
    </div>
    {!enabled ? <div className="wallet-disabled-panel glass-panel"><p>{methodLabel(method)} is not currently enabled by the server. No payment request was sent.</p></div> : <div className="wallet-form glass-panel">
      <p className="arena-fineprint">{method === 'demo' ? 'Practice currency only.' : `${methodLabel(method)} ${selectedRail?.environment ?? 'SANDBOX'} rail. The provider must verify the payment before the wallet changes.`}</p>
      {method !== 'demo' && selectedRail && <p className="arena-fineprint">Limits: {selectedRail.minAmount.toLocaleString()}–{selectedRail.maxAmount.toLocaleString()} {selectedRail.currency}{selectedRail.network ? ` · ${selectedRail.asset} on ${selectedRail.network}` : ''}</p>}
      {method !== 'demo' && kind === 'withdraw' && <input className="wallet-modal__custom-input" placeholder={method === 'upi' ? 'UPI destination' : 'Crypto address'} value={destination} disabled={busy} onChange={(event) => setDestination(event.target.value)} aria-label="Withdrawal destination" />}
      <div className="wallet-modal__topups">{QUICK_AMOUNTS.map((value) => <button key={value} type="button" className="arena-chip wallet-modal__topup-chip" disabled={busy || (kind === 'withdraw' && walletBalance !== undefined && value > walletBalance)} onClick={() => onQuick(value)}>{kind === 'deposit' ? '+' : '-'}🪙 {value.toLocaleString()}</button>)}</div>
      <div className="wallet-modal__custom-amount"><input type="number" inputMode="numeric" min={1} step={1} placeholder="Custom amount" className="wallet-modal__custom-input" value={amount} disabled={busy} onChange={(event) => setAmount(event.target.value)} aria-label={`Amount to ${kind}`} /><Button type="button" size="lg" disabled={busy || !amountValid} onClick={onSubmit}>{kind === 'deposit' ? 'Review deposit' : 'Review withdrawal'}</Button></div>
      {kind === 'withdraw' && method === 'demo' && <p className="arena-fineprint">The server rejects insufficient funds and protects duplicate requests with idempotency.</p>}
    </div>}
  </section>;
}

function MethodChip({ label, enabled, active, onClick }: { label: string; enabled: boolean; active: boolean; onClick: () => void }) {
  return <button type="button" role="tab" aria-selected={active} disabled={!enabled} className={`arena-chip wallet-method-chip ${active ? 'arena-chip--active' : ''} ${!enabled ? 'wallet-method-chip--disabled' : ''}`} onClick={onClick}>{label}{!enabled && <span className="wallet-method-chip__tag">Disabled</span>}</button>;
}

function PaymentMethodsPanel({ methods, loading }: { methods: PublicPaymentMethods | null; loading: boolean }) {
  if (loading && !methods) return <p className="arena-empty">Loading payment methods…</p>;
  const rails = methods?.methods ?? [];
  return <section className="wallet-methods-grid"><div className="wallet-method-card glass-panel"><h3>🪙 Demo Wallet</h3><p>{methods?.demoWallet.note ?? 'Practice currency only.'}</p><span className="wallet-method-card__status wallet-method-card__status--on">Available</span></div>{rails.length === 0 && <p className="arena-empty">No TEST/SANDBOX payment rails are enabled.</p>}{rails.map((rail, index) => <motion.div key={`${rail.method}-${rail.currency}-${rail.network}-${index}`} className="wallet-method-card glass-panel" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}><h3>{rail.method === 'UPI' ? '📲 UPI' : '₿ Crypto'} · {rail.currency}</h3><p>{rail.asset && rail.network ? `${rail.asset} on ${rail.network}` : 'Server-configured payment rail'}</p><p className="arena-fineprint">{rail.environment} · limits {rail.minAmount.toLocaleString()}–{rail.maxAmount.toLocaleString()}</p><span className="wallet-method-card__status wallet-method-card__status--on">{rail.depositEnabled || rail.withdrawalEnabled ? 'Enabled' : 'Disabled'}</span></motion.div>)}</section>;
}

function paymentDateInputValue(timestamp = Date.now()): string {
  const date = new Date(timestamp - new Date(timestamp).getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
}

function PaymentTxRow({ transaction }: { transaction: PlayerPaymentTransaction }) {
  const [updated, setUpdated] = useState<PlayerPaymentTransaction | null>(null);
  const [reference, setReference] = useState('');
  const [paymentAt, setPaymentAt] = useState(paymentDateInputValue());
  const [evidenceReference, setEvidenceReference] = useState('');
  const [proofBusy, setProofBusy] = useState(false);
  const [proofError, setProofError] = useState<string | null>(null);
  const current = updated ?? transaction;
  const proofAllowed = current.operation === 'DEPOSIT' && !current.proof && !['COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED', 'REVERSED'].includes(current.status) && current.workflowStatus !== 'VERIFIED';
  async function sendProof() {
    setProofBusy(true); setProofError(null);
    try {
      const submittedAt = Date.parse(paymentAt);
      if (!Number.isSafeInteger(submittedAt)) throw new Error('Choose the date and time of payment');
      const result = await submitPaymentProof(current.id, { amount: current.amount, reference, paymentAt: submittedAt, evidenceReference: evidenceReference || undefined });
      setUpdated(result);
      setReference('');
      setPaymentAt(paymentDateInputValue());
      setEvidenceReference('');
    } catch (error) {
      setProofError(error instanceof Error ? error.message : 'Proof submission failed');
    } finally { setProofBusy(false); }
  }
  return <article className="wallet-tx glass-panel"><div className="wallet-tx__main"><span className="wallet-tx__type">{current.operation === 'DEPOSIT' ? 'Deposit' : 'Withdrawal'} · {current.method}</span><span className="wallet-tx__time">{current.id} · {formatTime(current.createdAt)}</span></div><div className="wallet-tx__side"><span className={`wallet-tx__amount ${paymentStatusClass(current.status)}`}>{paymentStatusLabel(current.status)}</span><span className="wallet-tx__balance">{current.currency} {current.amount.toLocaleString()}</span></div>{current.failureReason && <p className="arena-fineprint arena-fineprint--warn">{current.failureReason}</p>}{current.instructions && current.status !== 'COMPLETED' && <p className="arena-fineprint">{current.instructions.label}: {current.instructions.value}</p>}{proofAllowed && <div className="wallet-proof-form"><p className="arena-fineprint">After paying, submit your UTR/provider reference. Evidence is reviewed by the assigned payment operator; it does not credit the wallet by itself.</p><input className="wallet-modal__custom-input" placeholder="UTR / provider reference" value={reference} disabled={proofBusy} onChange={(event) => setReference(event.target.value)} aria-label="Payment reference" /><label className="arena-fineprint" htmlFor={`payment-date-${current.id}`}>Payment date and time</label><input id={`payment-date-${current.id}`} className="wallet-modal__custom-input" type="datetime-local" value={paymentAt} disabled={proofBusy} onChange={(event) => setPaymentAt(event.target.value)} aria-label="Payment date and time" /><input className="wallet-modal__custom-input" placeholder="Optional evidence reference" value={evidenceReference} disabled={proofBusy} onChange={(event) => setEvidenceReference(event.target.value)} aria-label="Optional evidence reference" /><Button type="button" size="md" disabled={proofBusy || reference.trim().length < 4 || !paymentAt} onClick={() => void sendProof()}>{proofBusy ? 'Submitting…' : 'Submit payment proof'}</Button>{proofError && <p className="arena-fineprint arena-fineprint--warn" role="alert">{proofError}</p>}</div>}{current.workflowStatus && <p className="arena-fineprint">Workflow: {current.workflowStatus.replaceAll('_', ' ')}</p>}</article>;
}

function TxRow({ tx }: { tx: Transaction }) {
  return <li className="wallet-tx"><div className="wallet-tx__main"><span className="wallet-tx__type">{TRANSACTION_LABELS[tx.type]}</span><span className="wallet-tx__time">{formatTime(tx.timestamp)}</span></div><div className="wallet-tx__side"><span className={`wallet-tx__amount ${isCredit(tx.type) ? 'wallet-tx__amount--credit' : 'wallet-tx__amount--debit'}`}>{isCredit(tx.type) ? '+' : ''}{tx.amount.toLocaleString()}</span><span className="wallet-tx__balance">bal. {tx.balanceAfter.toLocaleString()}</span></div></li>;
}
