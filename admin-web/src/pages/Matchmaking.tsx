import { usePolling } from '../hooks';
import { Badge, ErrorBox, Loading } from '../components/ui';
import { fmtMs } from '../format';

interface QueueRow {
  entryFee: number;
  roomsInFlight: number;
  queuedRooms: number;
  oldestQueueAgeMs: number;
}
interface FormatQueues {
  format: string;
  label: string;
  queues: QueueRow[];
}
interface MatchmakingData {
  byFormat: FormatQueues[];
  flags: { duelEnabled: boolean; squadEnabled: boolean };
}

export function MatchmakingPage() {
  const { data, error, loading } = usePolling<MatchmakingData>('/admin/matchmaking', 4000);

  return (
    <div>
      <h1 className="admin-page-title">Matchmaking</h1>
      <p className="admin-page-sub">Live queue depth per format/stake. To enable/disable a format entirely, use Game → Game Controls (Feature Flags).</p>
      {error && <ErrorBox message={error} />}
      {loading && !data && <Loading />}
      {data &&
        data.byFormat.map((f) => (
          <div key={f.format} className="admin-panel">
            <div className="admin-panel__title">
              <span>{f.label}</span>
              <Badge tone={f.format === 'duel' ? (data.flags.duelEnabled ? 'green' : 'red') : data.flags.squadEnabled ? 'green' : 'red'}>
                {(f.format === 'duel' ? data.flags.duelEnabled : data.flags.squadEnabled) ? 'enabled' : 'disabled'}
              </Badge>
            </div>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Entry Fee</th>
                  <th>Rooms in flight</th>
                  <th>Queued (searching)</th>
                  <th>Oldest queue age</th>
                </tr>
              </thead>
              <tbody>
                {f.queues.map((q) => (
                  <tr key={q.entryFee}>
                    <td>🪙 {q.entryFee.toLocaleString()}</td>
                    <td>{q.roomsInFlight}</td>
                    <td>{q.queuedRooms}</td>
                    <td>{fmtMs(q.oldestQueueAgeMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
}
