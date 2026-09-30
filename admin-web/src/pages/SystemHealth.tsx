import { usePolling } from '../hooks';
import { Badge, ErrorBox, Loading } from '../components/ui';

interface SystemHealth {
  api: { status: string; uptimeMs: number };
  websocket: { status: string; connections: number };
  matchmaking: { status: string; activeRooms: number };
  database: { status: string; note: string };
  paymentProviders: { status: string };
  memory: { rssMb: number; heapUsedMb: number };
  admins: { total: number; activeToday: number };
}

export function SystemHealthPage() {
  const { data, error, loading } = usePolling<SystemHealth>('/admin/system/health', 8000);
  return (
    <div>
      <h1 className="admin-page-title">System Health</h1>
      <p className="admin-page-sub">Real process/service status — this build has no external APM wired up, so latency/error-rate percentiles are honestly reported as unavailable rather than fabricated.</p>
      {error && <ErrorBox message={error} />}
      {loading && !data && <Loading />}
      {data && (
        <table className="admin-table">
          <tbody>
            <tr>
              <td>API</td>
              <td><Badge tone="green">{data.api.status}</Badge></td>
              <td>Uptime: {Math.round(data.api.uptimeMs / 60000)} min</td>
            </tr>
            <tr>
              <td>WebSocket</td>
              <td><Badge tone={data.websocket.status === 'up' ? 'green' : 'red'}>{data.websocket.status}</Badge></td>
              <td>{data.websocket.connections} connection(s)</td>
            </tr>
            <tr>
              <td>Matchmaking</td>
              <td><Badge tone="green">{data.matchmaking.status}</Badge></td>
              <td>{data.matchmaking.activeRooms} room(s) in memory</td>
            </tr>
            <tr>
              <td>Database</td>
              <td><Badge tone="yellow">{data.database.status}</Badge></td>
              <td>{data.database.note}</td>
            </tr>
            <tr>
              <td>Payment Providers</td>
              <td><Badge tone="yellow">{data.paymentProviders.status}</Badge></td>
              <td>No real provider integrated yet</td>
            </tr>
            <tr>
              <td>Memory</td>
              <td colSpan={2}>RSS: {data.memory.rssMb}MB · Heap used: {data.memory.heapUsedMb}MB</td>
            </tr>
            <tr>
              <td>Admin accounts</td>
              <td colSpan={2}>{data.admins.total} total · {data.admins.activeToday} logged in today</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}
