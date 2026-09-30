import { useState } from 'react';
import { api, ApiError } from '../api';
import { usePolling } from '../hooks';
import { Badge, ConfirmActionModal, Drawer, Empty, ErrorBox, Loading } from '../components/ui';
import { fmtCoin, fmtTime } from '../format';
import { useAuth } from '../AuthContext';

interface AdminRoomSummary {
  id: string;
  gameKind: string;
  format: string;
  entryFee: number;
  status: string;
  playerCount: number;
  maxPlayers: number;
  pool: number;
  createdAt: number;
  matchStartedAt: number | null;
  matchEndsAt: number | null;
}

function statusTone(status: string) {
  if (status === 'active') return 'green' as const;
  if (status === 'finished') return 'blue' as const;
  if (status === 'cancelled') return 'red' as const;
  return 'yellow' as const;
}

export function RoomsPage() {
  const [statusFilter, setStatusFilter] = useState('all');
  const [selected, setSelected] = useState<string | null>(null);
  const { data, error, loading, reload } = usePolling<{ rooms: AdminRoomSummary[] }>('/admin/rooms', 4000);

  const rooms = (data?.rooms ?? []).filter((r) => statusFilter === 'all' || r.status === statusFilter);

  return (
    <div>
      <h1 className="admin-page-title">Live Matches & Rooms</h1>
      <p className="admin-page-sub">Every room currently held in server memory (auto-refreshes every 4s). Player identity shown here is the room-scoped public id, never a real account id.</p>

      <div className="admin-toolbar">
        <select className="admin-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="queued">Queued</option>
          <option value="ready_check">Ready Check</option>
          <option value="starting">Starting</option>
          <option value="active">Active</option>
          <option value="finished">Finished</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {error && <ErrorBox message={error} />}
      {loading && !data && <Loading />}
      {rooms.length === 0 && data && <Empty>No rooms match this filter right now.</Empty>}
      {rooms.length > 0 && (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Room</th>
              <th>Format</th>
              <th>Players</th>
              <th>Status</th>
              <th>Pool</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {rooms.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => setSelected(r.id)}>
                <td>{r.id}</td>
                <td>{r.format}</td>
                <td>
                  {r.playerCount}/{r.maxPlayers}
                </td>
                <td>
                  <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                </td>
                <td>{fmtCoin(r.pool)}</td>
                <td>{fmtTime(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selected && (
        <RoomDetailDrawer
          roomId={selected}
          onClose={() => setSelected(null)}
          onChanged={reload}
        />
      )}
    </div>
  );
}

interface RoomPlayerDetail {
  id: string;
  name: string;
  ready: boolean;
  score: number;
  correct: number;
  wrong: number;
  connectionState: string;
  hasActiveRound: boolean;
  activeRoundPhase: string | null;
}
interface RoomDetail extends AdminRoomSummary {
  players: RoomPlayerDetail[];
  readyDeadline: number | null;
  startsAt: number | null;
}

function RoomDetailDrawer({ roomId, onClose, onChanged }: { roomId: string; onClose: () => void; onChanged: () => void }) {
  const { has } = useAuth();
  const { data, error, loading } = usePolling<RoomDetail>(`/admin/rooms/${roomId}`, 3000, [roomId]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function cancelRoom(reason: string) {
    setBusy(true);
    setActionError(null);
    try {
      await api.post(`/admin/rooms/${roomId}/cancel`, { reason });
      setConfirming(false);
      onChanged();
      onClose();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to cancel room');
    } finally {
      setBusy(false);
    }
  }

  const canCancel = data && data.status !== 'finished' && data.status !== 'cancelled';

  return (
    <Drawer open onClose={onClose} title={`Room ${roomId}`}>
      {loading && !data && <Loading />}
      {error && <ErrorBox message={error} />}
      {data && (
        <>
          <dl className="admin-kv">
            <dt>Format</dt>
            <dd>{data.format}</dd>
            <dt>Status</dt>
            <dd>
              <Badge tone={statusTone(data.status)}>{data.status}</Badge>
            </dd>
            <dt>Pool</dt>
            <dd>{fmtCoin(data.pool)}</dd>
            <dt>Created</dt>
            <dd>{fmtTime(data.createdAt)}</dd>
            <dt>Match started</dt>
            <dd>{fmtTime(data.matchStartedAt)}</dd>
            <dt>Match ends</dt>
            <dd>{fmtTime(data.matchEndsAt)}</dd>
          </dl>

          {has('rooms.moderate') && canCancel && (
            <div style={{ marginTop: 14 }}>
              <button className="admin-btn admin-btn--danger admin-btn--sm" onClick={() => setConfirming(true)}>
                Force-cancel this room/match
              </button>
              <p className="admin-note" style={{ marginTop: 8 }}>
                Always treated as a full void — every entry fee is refunded and no winner is ever declared, regardless of current scores.
              </p>
            </div>
          )}
          {actionError && <ErrorBox message={actionError} />}

          <h4 style={{ marginTop: 20 }}>Players</h4>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Ready</th>
                <th>Score</th>
                <th>Correct/Wrong</th>
                <th>Connection</th>
                <th>Round</th>
              </tr>
            </thead>
            <tbody>
              {data.players.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.ready ? <Badge tone="green">ready</Badge> : <Badge tone="gray">not ready</Badge>}</td>
                  <td>{p.score}</td>
                  <td>
                    {p.correct}/{p.wrong}
                  </td>
                  <td>
                    <Badge tone={p.connectionState === 'connected' ? 'green' : p.connectionState === 'disconnected' ? 'yellow' : 'red'}>{p.connectionState}</Badge>
                  </td>
                  <td>{p.hasActiveRound ? p.activeRoundPhase : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {confirming && (
        <ConfirmActionModal
          title="Force-cancel this room/match?"
          description="This is a destructive, audited action. Every seated player is refunded; no winner is ever computed."
          danger
          busy={busy}
          onConfirm={cancelRoom}
          onCancel={() => setConfirming(false)}
        />
      )}
    </Drawer>
  );
}
