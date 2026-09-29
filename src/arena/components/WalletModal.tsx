import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Button } from '../../components/common/Button';
import { fetchWalletDetail } from '../api';
import { TRANSACTION_LABELS, type ArenaUser, type Transaction } from '../types';

interface WalletModalProps {
  open: boolean;
  user: ArenaUser;
  busy: boolean;
  onTopUp: (amount: number) => Promise<void> | void;
  onClose: () => void;
}

const TOP_UP_OPTIONS = [100, 500, 2000, 10000];

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

/** Full wallet view: live balance, top-up, and the real transaction ledger from the server —
 *  every entry fee debit, refund, payout, and top-up that has ever touched this wallet. */
export function WalletModal({ open, user, busy, onTopUp, onClose }: WalletModalProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toppingUp, setToppingUp] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // Intentional: this effect synchronizes with the external wallet API each time the modal
    // opens (or the balance changes after a top-up) — the loading/error flags reset per-fetch.
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
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  async function handleTopUp(amount: number) {
    setToppingUp(amount);
    try {
      await onTopUp(amount);
    } finally {
      setToppingUp(null);
    }
  }

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
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            className="wallet-modal glass-panel"
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.2, 0.9, 0.32, 1] }}
          >
            <button type="button" className="auth-modal__close" aria-label="Close" onClick={onClose}>
              ✕
            </button>

            <div className="wallet-modal__header">
              <span className="wallet-modal__label">Wallet balance</span>
              <span className="wallet-modal__balance">🪙 {user.walletBalance.toLocaleString()}</span>
            </div>

            <div className="wallet-modal__topups">
              {TOP_UP_OPTIONS.map((amount) => (
                <button
                  key={amount}
                  type="button"
                  className="arena-chip wallet-modal__topup-chip"
                  disabled={busy || toppingUp !== null}
                  onClick={() => void handleTopUp(amount)}
                >
                  {toppingUp === amount ? '…' : `+🪙 ${amount.toLocaleString()}`}
                </button>
              ))}
            </div>
            <p className="arena-fineprint">Practice currency only — no real payment is ever processed.</p>

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

            <Button variant="secondary" size="md" onClick={onClose}>
              Close
            </Button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
