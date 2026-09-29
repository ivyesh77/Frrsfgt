import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Button } from '../../components/common/Button';
import { fetchWalletDetail } from '../api';
import { TRANSACTION_LABELS, type ArenaUser, type Transaction } from '../types';

interface WalletModalProps {
  open: boolean;
  user: ArenaUser;
  busy: boolean;
  onTopUp: (amount: number) => Promise<void> | void;
  onWithdraw: (amount: number) => Promise<void> | void;
  onClose: () => void;
}

const AMOUNT_OPTIONS = [100, 500, 2000, 10000];

type WalletTab = 'deposit' | 'withdraw';

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** True when this ledger entry adds money to the wallet (shown in green with a + sign). */
function isCredit(type: Transaction['type']): boolean {
  return type === 'topup' || type === 'refund' || type === 'payout';
}

/** A stable, wallet-address-style id for flavor — purely cosmetic, derived from the guest
 *  account id (never a real crypto address; this product never touches real currency). */
function coinWalletId(userId: string): string {
  return `ARC-${userId.slice(0, 10).toUpperCase()}`;
}

/** Full wallet view: live balance, ArenaCoin deposit/withdraw, and the real transaction
 *  ledger from the server — every entry fee debit, refund, payout, deposit, and withdrawal
 *  that has ever touched this wallet. */
export function WalletModal({ open, user, busy, onTopUp, onWithdraw, onClose }: WalletModalProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<WalletTab>('deposit');
  const [pendingAmount, setPendingAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  /** Clears the scratch deposit/withdraw state so reopening the modal never shows a stale
   *  custom amount or error message left over from the last time it was open. */
  const handleClose = useCallback(() => {
    setCustomAmount('');
    setActionError(null);
    setPendingAmount(null);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // Intentional: this effect synchronizes with the external wallet API each time the modal
    // opens (or the balance changes after a deposit/withdrawal) — the loading/error flags reset
    // per-fetch.
    // eslint-disable-next-line react/set-state-in-effect
    setLoading(true);
    setLoadError(null);
    fetchWalletDetail(user.id)
      .then(({ transactions: txs }) => {
        if (!cancelled) setTransactions(txs);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Could not load transaction history');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, user.id, user.walletBalance]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') handleClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, handleClose]);

  /** Switches Deposit/Withdraw tabs and clears any leftover amount/error from the other flow. */
  function switchTab(next: WalletTab) {
    setTab(next);
    setCustomAmount('');
    setActionError(null);
  }

  async function runAmount(amount: number) {
    if (!Number.isFinite(amount) || amount <= 0) {
      setActionError('Enter a valid amount');
      return;
    }
    if (tab === 'withdraw' && amount > user.walletBalance) {
      setActionError('You cannot withdraw more than your wallet balance');
      return;
    }
    setActionError(null);
    setPendingAmount(amount);
    try {
      if (tab === 'deposit') await onTopUp(amount);
      else await onWithdraw(amount);
      setCustomAmount('');
    } finally {
      setPendingAmount(null);
    }
  }

  const customAmountNumber = Number(customAmount);
  const customAmountValid = customAmount.trim() !== '' && Number.isFinite(customAmountNumber) && customAmountNumber > 0;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="auth-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Wallet"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) handleClose();
          }}
        >
          <motion.div
            className="wallet-modal glass-panel"
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.2, 0.9, 0.32, 1] }}
          >
            <button type="button" className="auth-modal__close" aria-label="Close" onClick={handleClose}>
              ✕
            </button>

            <div className="wallet-modal__header">
              <span className="wallet-modal__label">ArenaCoin balance</span>
              <span className="wallet-modal__balance">🪙 {user.walletBalance.toLocaleString()} ARC</span>
              <span className="wallet-modal__coin-id">{coinWalletId(user.id)}</span>
            </div>

            <div className="wallet-modal__tabs" role="tablist" aria-label="Deposit or withdraw">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'deposit'}
                className={`wallet-modal__tab ${tab === 'deposit' ? 'wallet-modal__tab--active' : ''}`}
                onClick={() => switchTab('deposit')}
              >
                ⬇ Deposit
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'withdraw'}
                className={`wallet-modal__tab ${tab === 'withdraw' ? 'wallet-modal__tab--active' : ''}`}
                onClick={() => switchTab('withdraw')}
              >
                ⬆ Withdraw
              </button>
            </div>

            <div className="wallet-modal__topups">
              {AMOUNT_OPTIONS.map((amount) => {
                const overBalance = tab === 'withdraw' && amount > user.walletBalance;
                return (
                  <button
                    key={amount}
                    type="button"
                    className="arena-chip wallet-modal__topup-chip"
                    disabled={busy || pendingAmount !== null || overBalance}
                    onClick={() => void runAmount(amount)}
                  >
                    {pendingAmount === amount ? '…' : `${tab === 'deposit' ? '+' : '-'}🪙 ${amount.toLocaleString()}`}
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
                value={customAmount}
                disabled={busy || pendingAmount !== null}
                onChange={(e) => setCustomAmount(e.target.value)}
              />
              <Button
                variant="secondary"
                size="md"
                disabled={busy || pendingAmount !== null || !customAmountValid}
                onClick={() => void runAmount(customAmountNumber)}
              >
                {tab === 'deposit' ? 'Deposit' : 'Withdraw'}
              </Button>
            </div>
            {actionError && <p className="arena-fineprint arena-fineprint--warn">{actionError}</p>}

            <p className="arena-fineprint">
              ArenaCoin (ARC) is a practice, crypto-styled in-app currency — no real cryptocurrency or payment is
              ever processed.
            </p>

            <div className="wallet-modal__history">
              <h3 className="wallet-modal__history-title">Recent activity</h3>
              {loading && <p className="arena-empty">Loading…</p>}
              {loadError && <p className="arena-fineprint arena-fineprint--warn">{loadError}</p>}
              {!loading && !loadError && transactions.length === 0 && (
                <p className="arena-empty">No transactions yet.</p>
              )}
              {!loading && !loadError && transactions.length > 0 && (
                <ul className="wallet-tx-list">
                  {transactions.map((tx) => (
                    <li key={tx.id} className="wallet-tx">
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
                  ))}
                </ul>
              )}
            </div>

            <Button variant="secondary" size="md" onClick={handleClose}>
              Close
            </Button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
