import { usePolling } from '../hooks';
import { ErrorBox, Loading, StatCard } from '../components/ui';
import { fmtCoin } from '../format';

interface WalletOverview {
  totalBalance: number;
  available: number;
  pending: number;
  locked: number;
  todayInflow: number;
  todayOutflow: number;
  pendingWithdrawals: number;
  pendingDeposits: number;
  failedTransactions: number;
}

export function WalletOverviewPage() {
  const { data, error, loading } = usePolling<WalletOverview>('/admin/wallets/overview', 10000);

  return (
    <div>
      <h1 className="admin-page-title">Wallet Overview</h1>
      <p className="admin-page-sub">Aggregated from the real internal ledger. This is a practice-currency wallet — see Payments → Providers for real-money integration status.</p>
      {error && <ErrorBox message={error} />}
      {loading && !data && <Loading />}
      {data && (
        <>
          <div className="admin-grid">
            <StatCard label="Total Balance" value={fmtCoin(data.totalBalance)} />
            <StatCard label="Available" value={fmtCoin(data.available)} />
            <StatCard label="Pending" value={fmtCoin(data.pending)} small />
            <StatCard label="Locked" value={fmtCoin(data.locked)} small />
          </div>
          <div className="admin-grid">
            <StatCard label="Today Inflow" value={fmtCoin(data.todayInflow)} />
            <StatCard label="Today Outflow" value={fmtCoin(data.todayOutflow)} />
            <StatCard label="Pending Withdrawals" value={data.pendingWithdrawals} />
            <StatCard label="Pending Deposits" value={data.pendingDeposits} />
          </div>
          <div className="admin-grid">
            <StatCard label="Failed Transactions" value={data.failedTransactions} />
          </div>
          <div className="admin-note">
            "Pending"/"Locked" are always 0 today — this ledger's topup/withdraw operations complete synchronously; there is no async provider settlement step yet to hold funds in-flight.
          </div>
        </>
      )}
    </div>
  );
}
