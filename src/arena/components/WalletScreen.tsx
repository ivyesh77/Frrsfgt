import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from '../../components/common/Button';
import { fetchPaymentMethods, fetchWalletDetail } from '../api';
import { sounds } from '../sound';
import { haptics } from '../haptics';
import { coinWalletId, TRANSACTION_LABELS, type ArenaUser, type PublicPaymentMethods, type Transaction } from '../types';

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
  return type === 'topup' || type === 'refund' || type === 'payout' || type === 'signup_bonus';
}

/**
 * Full-screen wallet: balance + status, deposit (Demo Wallet / UPI / Crypto), withdraw,
 * payment methods, and the real transaction ledger. There is exactly ONE real money-moving
 * mechanism behind all of this — the server's authoritative topUp/withdraw endpoints (a
 * practice/demo currency ledger, see wallet.ts) — because no real payment processor is
 * integrated anywhere in this build. The UPI/Crypto "methods" are real, honestly-labeled
 * preview UI over that same demo mechanism; they are never allowed to claim a payment was
 * actually collected over a real UPI/crypto network, and are disabled outright whenever the
 * admin-configured flag for them is off (see /api/payment-methods), never faked as enabled.
 */
export function WalletScreen({ user, busy, onTopUp, onWithdraw }: WalletScreenProps) {
  const [tab, setTab] = useState<WalletTab>('overview');
  const [methods, setMethods] = useState<PublicPaymentMethods | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [depositMethod, setDepositMethod] = useState<DepositMethod>('demo');
  const [amount, setAmount] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    Promise.all([fetchPaymentMethods(), fetchWalletDetail()])
      .then(([m, detail]) => {
        setMethods(m);
        setTransactions(detail.transactions);
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
  }

  const amountNumber = Number(amount);
  const amountValid = amount.trim() !== '' && Number.isFinite(amountNumber) && amountNumber > 0;

  async function runAmount(kind: 'deposit' | 'withdraw', value: number, methodLabel: string) {
    if (!Number.isFinite(value) || value <= 0) {
      setActionError('Enter a valid amount');
      sounds.error();
      return;
    }
    if (kind === 'withdraw' && value > user.walletBalance) {
      setActionError('You cannot withdraw more than your wallet balance');
      sounds.error();
      return;
    }
    setActionError(null);
    setActionNotice(null);
    setPending(true);
    try {
      if (kind === 'deposit') await onTopUp(value);
      else await onWithdraw(value);
      sounds.walletSuccess();
      haptics.tap();
      setAmount('');
      setActionNotice(
        methodLabel === 'Demo Wallet'
          ? `${kind === 'deposit' ? 'Deposited' : 'Withdrew'} 🪙 ${value.toLocaleString()} successfully.`
          : `🪙 ${value.toLocaleString()} ${kind === 'deposit' ? 'credited to' : 'debited from'} your practice wallet. No real ${methodLabel} network was contacted — this build has no live payment processor connected.`,
      );
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
        <p className="arena-subtitle arena-subtitle--sm">Practice currency only — never real money. Status: <strong>Active</strong>.</p>
      </header>

      <section className="wallet-balance-card glass-panel">
        <span className="wallet-modal__label">Balance</span>
        <span className="wallet-modal__balance">🪙 {user.walletBalance.toLocaleString()} ARC</span>
        <span className="wallet-modal__coin-id">{coinWalletId(user.id)}</span>
      </section>

      <nav className="wallet-tabs" role="tablist" aria-label="Wallet sections">
        {([
          ['overview', 'Overview'],
          ['deposit', 'Deposit'],
          ['withdraw', 'Withdraw'],
          ['methods', 'Payment Methods'],
          ['transactions', 'Transactions'],
        ] as Array<[WalletTab, string]>).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`wallet-modal__tab ${tab === id ? 'wallet-modal__tab--active' : ''}`} onClick={() => switchTab(id)}>
            {label}
          </button>
        ))}
      </nav>

      {loadError && <p className="arena-fineprint arena-fineprint--warn">{loadError}</p>}

      {tab === 'overview' && (
        <section className="wallet-overview">
          <p className="arena-fineprint">
            ArenaCoin (ARC) is a practice, crypto-styled in-app currency. No real cryptocurrency, UPI transfer, or payment of any kind is
            ever processed by this application.
          </p>
          <div className="wallet-tx-list">
            {transactions.slice(0, 5).map((tx) => (
              <TxRow key={tx.id} tx={tx} />
            ))}
            {!loading && transactions.length === 0 && <p className="arena-empty">No transactions yet.</p>}
          </div>
        </section>
      )}

      {tab === 'deposit' && (
        <section className="wallet-deposit">
          <MethodPicker methods={methods} kind="deposit" active={depositMethod} onChange={setDepositMethod} />
          <DepositOrWithdrawForm
            kind="deposit"
            method={depositMethod}
            methods={methods}
            amount={amount}
            setAmount={setAmount}
            amountValid={amountValid}
            busy={busy || pending}
            onQuick={(a) => void runAmount('deposit', a, methodLabel(depositMethod))}
            onSubmit={() => void runAmount('deposit', amountNumber, methodLabel(depositMethod))}
          />
        </section>
      )}

      {tab === 'withdraw' && (
        <section className="wallet-deposit">
          <MethodPicker methods={methods} kind="withdraw" active={depositMethod} onChange={setDepositMethod} />
          <DepositOrWithdrawForm
            kind="withdraw"
            method={depositMethod}
            methods={methods}
            amount={amount}
            setAmount={setAmount}
            amountValid={amountValid}
            walletBalance={user.walletBalance}
            busy={busy || pending}
            onQuick={(a) => void runAmount('withdraw', a, methodLabel(depositMethod))}
            onSubmit={() => void runAmount('withdraw', amountNumber, methodLabel(depositMethod))}
          />
        </section>
      )}

      {(actionError || actionNotice) && (
        <p className={`arena-fineprint ${actionError ? 'arena-fineprint--warn' : ''}`} role={actionError ? 'alert' : 'status'}>
          {actionError ?? actionNotice}
        </p>
      )}

      {tab === 'methods' && <PaymentMethodsPanel methods={methods} loading={loading} />}

      {tab === 'transactions' && (
        <section className="wallet-transactions">
          {loading && <p className="arena-empty">Loading…</p>}
          {!loading && transactions.length === 0 && <p className="arena-empty">No transactions yet.</p>}
          {!loading && transactions.length > 0 && (
            <ul className="wallet-tx-list">
              {transactions.map((tx) => (
                <TxRow key={tx.id} tx={tx} />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function methodLabel(m: DepositMethod): string {
  return m === 'demo' ? 'Demo Wallet' : m === 'upi' ? 'UPI' : 'Crypto';
}

function MethodPicker({ methods, kind, active, onChange }: { methods: PublicPaymentMethods | null; kind: 'deposit' | 'withdraw'; active: DepositMethod; onChange: (m: DepositMethod) => void }) {
  const upiEnabled = methods?.upi?.enabled ?? false;
  const cryptoEnabled = methods?.crypto.some((c) => (kind === 'deposit' ? c.depositEnabled : c.withdrawEnabled)) ?? false;
  return (
    <div className="wallet-method-picker" role="tablist" aria-label="Payment method">
      <MethodChip id="demo" label="🪙 Demo Wallet" enabled active={active === 'demo'} onClick={() => onChange('demo')} />
      <MethodChip id="upi" label="📲 UPI" enabled={upiEnabled} active={active === 'upi'} onClick={() => onChange('upi')} />
      <MethodChip id="crypto" label="₿ Crypto" enabled={cryptoEnabled} active={active === 'crypto'} onClick={() => onChange('crypto')} />
    </div>
  );
}

function MethodChip({ label, enabled, active, onClick }: { id: string; label: string; enabled: boolean; active: boolean; onClick: () => void }) {
  return (
    <button type="button" role="tab" aria-selected={active} className={`arena-chip wallet-method-chip ${active ? 'arena-chip--active' : ''} ${!enabled ? 'wallet-method-chip--disabled' : ''}`} onClick={onClick}>
      {label}
      {!enabled && <span className="wallet-method-chip__tag">Disabled</span>}
    </button>
  );
}

interface DepositFormProps {
  kind: 'deposit' | 'withdraw';
  method: DepositMethod;
  methods: PublicPaymentMethods | null;
  amount: string;
  setAmount: (v: string) => void;
  amountValid: boolean;
  walletBalance?: number;
  busy: boolean;
  onQuick: (amount: number) => void;
  onSubmit: () => void;
}

function DepositOrWithdrawForm({ kind, method, methods, amount, setAmount, amountValid, walletBalance, busy, onQuick, onSubmit }: DepositFormProps) {
  const enabled =
    method === 'demo'
      ? true
      : method === 'upi'
        ? (methods?.upi?.enabled ?? false)
        : (methods?.crypto.some((c) => (kind === 'deposit' ? c.depositEnabled : c.withdrawEnabled)) ?? false);

  if (!enabled) {
    return (
      <div className="wallet-disabled-panel glass-panel">
        <p>
          {methodLabel(method)} {kind === 'deposit' ? 'deposits are' : 'withdrawals are'} currently disabled by the platform. Use the Demo
          Wallet method instead — it's the only method this build supports end-to-end.
        </p>
      </div>
    );
  }

  return (
    <div className="wallet-form glass-panel">
      {method !== 'demo' && (
        <p className="arena-fineprint">
          Preview UI only — this build has no live {methodLabel(method)} payment processor connected. Confirming below credits/debits your
          practice wallet directly, exactly like the Demo Wallet method.
        </p>
      )}
      <div className="wallet-modal__topups">
        {QUICK_AMOUNTS.map((a) => {
          const overBalance = kind === 'withdraw' && walletBalance !== undefined && a > walletBalance;
          return (
            <button key={a} type="button" className="arena-chip wallet-modal__topup-chip" disabled={busy || overBalance} onClick={() => onQuick(a)}>
              {kind === 'deposit' ? '+' : '-'}🪙 {a.toLocaleString()}
            </button>
          );
        })}
      </div>
      <div className="wallet-modal__custom-amount">
        <input
          type="number"
          inputMode="numeric"
          min={1}
          placeholder="Custom amount"
          className="wallet-modal__custom-input"
          value={amount}
          disabled={busy}
          onChange={(e) => setAmount(e.target.value)}
          aria-label={`Amount to ${kind}`}
        />
        <Button variant="secondary" size="md" disabled={busy || !amountValid} onClick={onSubmit}>
          {kind === 'deposit' ? 'Deposit' : 'Withdraw'}
        </Button>
      </div>
    </div>
  );
}

function PaymentMethodsPanel({ methods, loading }: { methods: PublicPaymentMethods | null; loading: boolean }) {
  if (loading) return <p className="arena-empty">Loading…</p>;
  if (!methods) return null;
  return (
    <section className="wallet-methods-panel">
      <motion.div className="wallet-method-card glass-panel" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <h3>🪙 Demo Wallet</h3>
        <p>{methods.demoWallet.note}</p>
        <span className="wallet-method-card__status wallet-method-card__status--on">Active</span>
      </motion.div>
      <motion.div className="wallet-method-card glass-panel" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <h3>📲 UPI</h3>
        <p>
          {methods.upi?.enabled
            ? `Enabled · ₹${methods.upi.minAmount}–₹${methods.upi.maxAmount} per transaction (preview UI; no live processor connected).`
            : 'Disabled by the platform. No real UPI integration exists in this build.'}
        </p>
        <span className={`wallet-method-card__status ${methods.upi?.enabled ? 'wallet-method-card__status--on' : 'wallet-method-card__status--off'}`}>
          {methods.upi?.enabled ? 'Enabled' : 'Disabled'}
        </span>
      </motion.div>
      {methods.crypto.map((c) => (
        <motion.div key={`${c.asset}-${c.network}`} className="wallet-method-card glass-panel" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <h3>
            ₿ {c.asset} <span className="wallet-method-card__network">({c.network})</span>
          </h3>
          <p>
            {c.depositEnabled || c.withdrawEnabled
              ? `Min ${c.minAmount} / Max ${c.maxAmount} · ${c.confirmationsRequired} confirmation(s) required (preview UI; no live blockchain connection).`
              : 'Disabled by the platform.'}
          </p>
          <span className={`wallet-method-card__status ${c.depositEnabled || c.withdrawEnabled ? 'wallet-method-card__status--on' : 'wallet-method-card__status--off'}`}>
            {c.depositEnabled || c.withdrawEnabled ? 'Enabled' : 'Disabled'}
          </span>
        </motion.div>
      ))}
    </section>
  );
}

function TxRow({ tx }: { tx: Transaction }) {
  return (
    <li className="wallet-tx">
      <div className="wallet-tx__main">
        <span className="wallet-tx__type">{TRANSACTION_LABELS[tx.type]}</span>
        <span className="wallet-tx__time">{formatTime(tx.timestamp)}</span>
      </div>
      <div className="wallet-tx__side">
        <span className={`wallet-tx__amount ${isCredit(tx.type) ? 'wallet-tx__amount--credit' : 'wallet-tx__amount--debit'}`}>
          {isCredit(tx.type) ? '+' : ''}
          {tx.amount.toLocaleString()}
        </span>
        <span className="wallet-tx__balance">bal. {tx.balanceAfter.toLocaleString()}</span>
      </div>
    </li>
  );
}
