import { useState } from 'react';
import { usePolling } from '../hooks';
import { ErrorBox, Loading, StatCard } from '../components/ui';

interface UserAnalytics {
  dau: number;
  wau: number;
  mau: number;
  totalRegistrations: number;
  registrationsToday: number;
}
interface GameAnalytics {
  matchesStarted: number;
  matchesCompleted: number;
  duelCount: number;
  squadCount: number;
  averageMatchDurationMs: number;
  queueAbandonment: number;
}
interface PaymentAnalytics {
  deposits: number;
  withdrawals: number;
  successRate: number | null;
  failureRate: number | null;
  pendingVolume: number;
  note: string;
}

export function AnalyticsPage() {
  const [tab, setTab] = useState<'users' | 'games' | 'payments'>('users');
  const users = usePolling<UserAnalytics>('/admin/analytics/users', 15000);
  const games = usePolling<GameAnalytics>('/admin/analytics/games', 15000);
  const payments = usePolling<PaymentAnalytics>('/admin/analytics/payments', 15000);

  return (
    <div>
      <h1 className="admin-page-title">Analytics Center</h1>
      <p className="admin-page-sub">All figures are computed live from the authoritative backend on every request — never estimated or cached stale.</p>
      <div className="admin-tabs">
        <div className={`admin-tab ${tab === 'users' ? 'active' : ''}`} onClick={() => setTab('users')}>Users</div>
        <div className={`admin-tab ${tab === 'games' ? 'active' : ''}`} onClick={() => setTab('games')}>Games</div>
        <div className={`admin-tab ${tab === 'payments' ? 'active' : ''}`} onClick={() => setTab('payments')}>Payments</div>
      </div>

      {tab === 'users' && (
        <>
          {users.error && <ErrorBox message={users.error} />}
          {users.loading && !users.data && <Loading />}
          {users.data && (
            <div className="admin-grid">
              <StatCard label="New Signups (24h)" value={users.data.dau} />
              <StatCard label="New Signups (7d)" value={users.data.wau} />
              <StatCard label="New Signups (30d)" value={users.data.mau} />
              <StatCard label="Total Registrations" value={users.data.totalRegistrations} />
              <StatCard label="Registrations Today" value={users.data.registrationsToday} />
            </div>
          )}
          <div className="admin-note">DAU/WAU/MAU here count NEW signups within the window, not distinct logins — historical login events aren't persisted long-term yet.</div>
        </>
      )}
      {tab === 'games' && (
        <>
          {games.error && <ErrorBox message={games.error} />}
          {games.loading && !games.data && <Loading />}
          {games.data && (
            <div className="admin-grid">
              <StatCard label="Matches Started" value={games.data.matchesStarted} />
              <StatCard label="Matches Completed" value={games.data.matchesCompleted} />
              <StatCard label="1v1 Duels" value={games.data.duelCount} />
              <StatCard label="1v1v1v1 Squads" value={games.data.squadCount} />
              <StatCard label="Avg Match Duration" value={`${Math.round(games.data.averageMatchDurationMs / 1000)}s`} />
              <StatCard label="Cancelled / Abandoned" value={games.data.queueAbandonment} />
            </div>
          )}
        </>
      )}
      {tab === 'payments' && (
        <>
          {payments.error && <ErrorBox message={payments.error} />}
          {payments.loading && !payments.data && <Loading />}
          {payments.data && (
            <div className="admin-grid">
              <StatCard label="Deposits" value={payments.data.deposits} />
              <StatCard label="Withdrawals" value={payments.data.withdrawals} />
              <StatCard label="Success Rate" value={payments.data.successRate !== null ? `${Math.round(payments.data.successRate * 100)}%` : '—'} />
              <StatCard label="Failure Rate" value={payments.data.failureRate !== null ? `${Math.round(payments.data.failureRate * 100)}%` : '—'} />
              <StatCard label="Pending Volume" value={payments.data.pendingVolume} />
            </div>
          )}
          {payments.data && <div className="admin-note">{payments.data.note}</div>}
        </>
      )}
    </div>
  );
}
