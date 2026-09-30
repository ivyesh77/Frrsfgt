import { usePolling } from '../hooks';
import { Badge, ErrorBox, Loading, StatCard } from '../components/ui';

interface DashboardData {
  usersOnline: number;
  activeRooms: number;
  activeMatches: number;
  matchmakingQueue: number;
  todaysGames: number;
  todaysUsers: number;
  deposits: number;
  withdrawals: number;
  pendingTransactions: number;
  paymentFailures: number;
  systemHealth: string;
  errorRateLastHour: number;
  websocketStatus: string;
  uptimeMs: number;
  recentFailedAdminLoginsLastHour: number;
}

export function DashboardPage() {
  const { data, error, loading } = usePolling<DashboardData>('/admin/dashboard', 5000);

  return (
    <div>
      <h1 className="admin-page-title">Operations Dashboard</h1>
      <p className="admin-page-sub">Live server state, refreshed every 5 seconds. Every number here is read directly from the real backend — nothing is simulated.</p>
      {error && <ErrorBox message={error} />}
      {loading && !data && <Loading />}
      {data && (
        <>
          <div className="admin-grid">
            <StatCard label="Users Online" value={data.usersOnline} />
            <StatCard label="Active Rooms" value={data.activeRooms} />
            <StatCard label="Active Matches" value={data.activeMatches} />
            <StatCard label="Matchmaking Queue" value={data.matchmakingQueue} />
          </div>
          <div className="admin-grid">
            <StatCard label="Today's Games" value={data.todaysGames} />
            <StatCard label="Today's New Users" value={data.todaysUsers} />
            <StatCard label="Deposits (all-time)" value={data.deposits} />
            <StatCard label="Withdrawals (all-time)" value={data.withdrawals} />
          </div>
          <div className="admin-grid">
            <StatCard label="Pending Transactions" value={data.pendingTransactions} />
            <StatCard label="Payment Failures" value={data.paymentFailures} />
            <StatCard
              label="WebSocket Status"
              value={<Badge tone={data.websocketStatus === 'up' ? 'green' : 'red'}>{data.websocketStatus}</Badge>}
              small
            />
            <StatCard label="Failed Admin Logins (1h)" value={data.recentFailedAdminLoginsLastHour} />
          </div>
          <div className="admin-note">
            System health: <Badge tone="green">{data.systemHealth}</Badge> · Uptime {Math.round(data.uptimeMs / 60000)} min · API latency/error-rate APM is not wired up in this build — see System → Health for what is and isn't real here.
          </div>
        </>
      )}
    </div>
  );
}
