import { useState } from 'react';
import { api, ApiError } from '../api';
import { usePolling } from '../hooks';
import { Badge, ConfirmActionModal, Drawer, Empty, ErrorBox, Loading } from '../components/ui';
import { fmtCoin, fmtTime } from '../format';
import { useAuth } from '../AuthContext';

interface UserRow {
  id: string;
  name: string;
  status: 'active' | 'suspended' | 'banned';
  createdAt: number;
  walletBalance: number;
  matchesPlayed: number;
  online: boolean;
}
interface ListUsersResult {
  rows: UserRow[];
  total: number;
  page: number;
  pageSize: number;
}

function statusTone(status: string) {
  if (status === 'active') return 'green' as const;
  if (status === 'suspended') return 'yellow' as const;
  return 'red' as const;
}

export function UsersPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const pageSize = 25;

  const { data, error, loading, reload } = usePolling<ListUsersResult>(
    `/admin/users?page=${page}&pageSize=${pageSize}&search=${encodeURIComponent(search)}&filter=${filter}`,
    null,
    [page, search, filter],
  );

  return (
    <div>
      <h1 className="admin-page-title">Users</h1>
      <p className="admin-page-sub">Server-side paginated, searched, and filtered — the full dataset is never loaded into the browser.</p>

      <div className="admin-toolbar">
        <input
          className="admin-input"
          placeholder="Search by name or public ID…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          style={{ minWidth: 260 }}
        />
        <select
          className="admin-select"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="banned">Banned</option>
          <option value="online">Online</option>
          <option value="offline">Offline</option>
        </select>
      </div>

      {error && <ErrorBox message={error} />}
      {loading && !data && <Loading />}
      {data && data.rows.length === 0 && <Empty>No users match this search/filter.</Empty>}
      {data && data.rows.length > 0 && (
        <>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Status</th>
                <th>Online</th>
                <th>Joined</th>
                <th>Matches</th>
                <th>Wallet</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((u) => (
                <tr key={u.id} className="clickable" onClick={() => setSelectedId(u.id)}>
                  <td>{u.name}</td>
                  <td>
                    <Badge tone={statusTone(u.status)}>{u.status}</Badge>
                  </td>
                  <td>{u.online ? <Badge tone="green">online</Badge> : <Badge tone="gray">offline</Badge>}</td>
                  <td>{fmtTime(u.createdAt)}</td>
                  <td>{u.matchesPlayed}</td>
                  <td>{fmtCoin(u.walletBalance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="admin-pagination">
            <span>
              Page {data.page} · {data.total} total
            </span>
            <button className="admin-btn admin-btn--ghost admin-btn--sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              ← Prev
            </button>
            <button className="admin-btn admin-btn--ghost admin-btn--sm" disabled={page * pageSize >= data.total} onClick={() => setPage((p) => p + 1)}>
              Next →
            </button>
          </div>
        </>
      )}

      {selectedId && <UserDetailDrawer userId={selectedId} onClose={() => setSelectedId(null)} onChanged={reload} />}
    </div>
  );
}

interface UserDetail {
  id: string;
  name: string;
  status: 'active' | 'suspended' | 'banned';
  createdAt: number;
  walletBalance: number;
  activeSessionCount: number;
  online: boolean;
  matchHistory: Array<{ roomId: string; format: string; entryFee: number; status: string; endedAt: number; winnerIds: string[] }>;
  transactions: Array<{ id: string; type: string; amount: number; status: string; timestamp: number }>;
  supportNotes: Array<{ id: string; note: string; authorName: string; createdAt: number }>;
  recentAnswerRatePerMinute: number;
}

function UserDetailDrawer({ userId, onClose, onChanged }: { userId: string; onClose: () => void; onChanged: () => void }) {
  const { has } = useAuth();
  const { data, error, loading, reload } = usePolling<UserDetail>(`/admin/users/${userId}`, null, [userId]);
  const [pendingAction, setPendingAction] = useState<null | 'suspend' | 'unsuspend' | 'ban' | 'unban' | 'force-logout'>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [noteBusy, setNoteBusy] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustDirection, setAdjustDirection] = useState<'credit' | 'debit'>('credit');
  const [adjustReference, setAdjustReference] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [adjustBusy, setAdjustBusy] = useState(false);
  const [adjustError, setAdjustError] = useState<string | null>(null);

  async function submitAdjustment() {
    const amount = Number(adjustAmount);
    if (!Number.isFinite(amount) || amount <= 0 || !adjustReason.trim()) return;
    setAdjustBusy(true);
    setAdjustError(null);
    try {
      await api.post(`/admin/wallets/${userId}/adjustment`, { amount, direction: adjustDirection, reason: adjustReason.trim(), reference: adjustReference.trim() });
      setAdjustOpen(false);
      setAdjustAmount('');
      setAdjustReference('');
      setAdjustReason('');
      reload();
      onChanged();
    } catch (err) {
      setAdjustError(err instanceof ApiError ? err.message : 'Adjustment failed');
    } finally {
      setAdjustBusy(false);
    }
  }

  async function runAction(reason: string) {
    if (!pendingAction) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.post(`/admin/users/${userId}/${pendingAction}`, { reason });
      setPendingAction(null);
      reload();
      onChanged();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  async function addNote() {
    if (!noteText.trim()) return;
    setNoteBusy(true);
    try {
      await api.post(`/admin/users/${userId}/notes`, { note: noteText.trim() });
      setNoteText('');
      reload();
    } finally {
      setNoteBusy(false);
    }
  }

  return (
    <Drawer open onClose={onClose} title={data?.name ?? 'User'}>
      {loading && !data && <Loading />}
      {error && <ErrorBox message={error} />}
      {data && (
        <>
          <dl className="admin-kv">
            <dt>Status</dt>
            <dd>
              <Badge tone={statusTone(data.status)}>{data.status}</Badge>
            </dd>
            <dt>Online</dt>
            <dd>{data.online ? <Badge tone="green">online</Badge> : <Badge tone="gray">offline</Badge>}</dd>
            <dt>Joined</dt>
            <dd>{fmtTime(data.createdAt)}</dd>
            <dt>Wallet balance</dt>
            <dd>{fmtCoin(data.walletBalance)}</dd>
            <dt>Active sessions</dt>
            <dd>{data.activeSessionCount}</dd>
            <dt>Recent answer rate</dt>
            <dd>{data.recentAnswerRatePerMinute}/min</dd>
          </dl>

          {has('users.moderate') && (
            <div className="admin-toolbar" style={{ marginTop: 16 }}>
              {data.status === 'active' && (
                <button className="admin-btn admin-btn--danger admin-btn--sm" onClick={() => setPendingAction('suspend')}>
                  Suspend
                </button>
              )}
              {data.status === 'suspended' && (
                <button className="admin-btn admin-btn--sm" onClick={() => setPendingAction('unsuspend')}>
                  Unsuspend
                </button>
              )}
              {data.status !== 'banned' && (
                <button className="admin-btn admin-btn--danger admin-btn--sm" onClick={() => setPendingAction('ban')}>
                  Ban
                </button>
              )}
              {data.status === 'banned' && (
                <button className="admin-btn admin-btn--sm" onClick={() => setPendingAction('unban')}>
                  Unban
                </button>
              )}
              <button className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => setPendingAction('force-logout')}>
                Force Logout
              </button>
            </div>
          )}
          {actionError && <ErrorBox message={actionError} />}

          {has('wallet.adjust') && (
            <div style={{ marginTop: 10 }}>
              {!adjustOpen ? (
                <button className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => setAdjustOpen(true)}>
                  Create balance adjustment
                </button>
              ) : (
                <div className="admin-panel" style={{ marginTop: 10 }}>
                  <div className="admin-panel__title">Audited balance adjustment</div>
                  <p className="admin-note">Never a direct balance edit — this produces a distinct, traceable ledger transaction with a before/after balance, and adjustments ≥ 50,000 require a second admin's approval.</p>
                  <div className="admin-toolbar">
                    <select className="admin-select" value={adjustDirection} onChange={(e) => setAdjustDirection(e.target.value as 'credit' | 'debit')}>
                      <option value="credit">Credit (add funds)</option>
                      <option value="debit">Debit (remove funds)</option>
                    </select>
                    <input className="admin-input" type="number" placeholder="Amount" value={adjustAmount} onChange={(e) => setAdjustAmount(e.target.value)} />
                  </div>
                  <input className="admin-input" style={{ width: '100%' }} placeholder="Reference (e.g. support ticket #)" value={adjustReference} onChange={(e) => setAdjustReference(e.target.value)} />
                  <textarea className="admin-input" style={{ width: '100%', minHeight: 50 }} placeholder="Reason (required, audited)" value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} />
                  {adjustError && <ErrorBox message={adjustError} />}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => setAdjustOpen(false)} disabled={adjustBusy}>
                      Cancel
                    </button>
                    <button className="admin-btn admin-btn--sm" disabled={adjustBusy || !adjustAmount || !adjustReason.trim()} onClick={submitAdjustment}>
                      {adjustBusy ? 'Submitting…' : 'Submit adjustment'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <h4 style={{ marginTop: 20 }}>Match History</h4>
          {data.matchHistory.length === 0 ? (
            <Empty>No matches played yet.</Empty>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Room</th>
                  <th>Format</th>
                  <th>Entry</th>
                  <th>Status</th>
                  <th>Ended</th>
                </tr>
              </thead>
              <tbody>
                {data.matchHistory.slice(0, 10).map((m) => (
                  <tr key={m.roomId}>
                    <td>{m.roomId}</td>
                    <td>{m.format}</td>
                    <td>{fmtCoin(m.entryFee)}</td>
                    <td>
                      <Badge tone={m.status === 'finished' ? 'green' : 'gray'}>{m.status}</Badge>
                    </td>
                    <td>{fmtTime(m.endedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h4 style={{ marginTop: 20 }}>Transactions</h4>
          {data.transactions.length === 0 ? (
            <Empty>No transactions yet.</Empty>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {data.transactions.slice(0, 10).map((t) => (
                  <tr key={t.id}>
                    <td>{t.type}</td>
                    <td>{fmtCoin(t.amount)}</td>
                    <td>
                      <Badge tone={t.status === 'completed' ? 'green' : t.status === 'failed' ? 'red' : 'yellow'}>{t.status}</Badge>
                    </td>
                    <td>{fmtTime(t.timestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h4 style={{ marginTop: 20 }}>Support Notes</h4>
          {has('users.notes') && (
            <div style={{ marginBottom: 10 }}>
              <textarea
                className="admin-input"
                style={{ width: '100%', minHeight: 60 }}
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add an internal support note…"
              />
              <button className="admin-btn admin-btn--sm" style={{ marginTop: 6 }} disabled={!noteText.trim() || noteBusy} onClick={addNote}>
                Add note
              </button>
            </div>
          )}
          {data.supportNotes.length === 0 ? (
            <Empty>No notes yet.</Empty>
          ) : (
            data.supportNotes.map((n) => (
              <div key={n.id} className="admin-note" style={{ marginBottom: 8 }}>
                <strong>{n.authorName}</strong> · {fmtTime(n.createdAt)}
                <div>{n.note}</div>
              </div>
            ))
          )}
        </>
      )}

      {pendingAction && (
        <ConfirmActionModal
          title={`${pendingAction.replace('-', ' ')} this user?`}
          description="This action is permission-gated, requires a reason, and is recorded in the audit log."
          danger={pendingAction === 'suspend' || pendingAction === 'ban'}
          busy={busy}
          onConfirm={runAction}
          onCancel={() => setPendingAction(null)}
        />
      )}
    </Drawer>
  );
}
