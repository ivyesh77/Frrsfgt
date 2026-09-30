import { usePolling } from '../hooks';
import { Empty, ErrorBox, Loading, StatCard } from '../components/ui';

interface AntiCheatSummary {
  activeMatches: number;
  rateLimitedAnswersLastHour: number;
  staleRoundRejectionsLastHour: number;
  tooFastRejectionsLastHour: number;
  timeoutsLastHour: number;
  nonMemberAttemptsLastHour: number;
  flaggedPlayers: Array<{ subject: string; count: number }>;
}

export function AntiCheatPage() {
  const { data, error, loading } = usePolling<AntiCheatSummary>('/admin/anticheat', 10000);
  return (
    <div>
      <h1 className="admin-page-title">Anti-Cheat Monitoring</h1>
      <p className="admin-page-sub">Reads the exact server-side gameplay rejections already enforced by the game engine — this panel never makes its own cheat-detection decisions.</p>
      {error && <ErrorBox message={error} />}
      {loading && !data && <Loading />}
      {data && (
        <>
          <div className="admin-grid">
            <StatCard label="Active Matches" value={data.activeMatches} />
            <StatCard label="Rate-Limited Answers (1h)" value={data.rateLimitedAnswersLastHour} />
            <StatCard label="Stale Round Rejections (1h)" value={data.staleRoundRejectionsLastHour} />
            <StatCard label="Too-Fast Rejections (1h)" value={data.tooFastRejectionsLastHour} />
          </div>
          <div className="admin-grid">
            <StatCard label="Timeouts (1h)" value={data.timeoutsLastHour} />
            <StatCard label="Non-Member Attempts (1h)" value={data.nonMemberAttemptsLastHour} />
          </div>
          <div className="admin-panel">
            <div className="admin-panel__title">Flagged players (stale-round / too-fast rejections)</div>
            {data.flaggedPlayers.length === 0 ? (
              <Empty>No flagged players in the last hour.</Empty>
            ) : (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Player ID</th>
                    <th>Rejection count</th>
                  </tr>
                </thead>
                <tbody>
                  {data.flaggedPlayers.map((p) => (
                    <tr key={p.subject}>
                      <td>{p.subject}</td>
                      <td>{p.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
