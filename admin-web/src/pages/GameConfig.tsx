import { useState } from 'react';
import { api, ApiError } from '../api';
import { usePolling } from '../hooks';
import { Empty, ErrorBox, Loading } from '../components/ui';
import { fmtTime } from '../format';
import { useAuth } from '../AuthContext';

interface GameConfig {
  matchDurationMs: number;
  readyCountdownMs: number;
  roundMemorizeMs: number;
  roundAnswerMs: number;
  lobbyReadyTimeoutMs: number;
  reconnectGraceMs: number;
  correctScoreDelta: number;
  wrongPenaltyDelta: number;
  duelEnabled: boolean;
  squadEnabled: boolean;
}
interface HistoryEntry {
  key: string;
  previousValue: unknown;
  newValue: unknown;
  changedByName: string;
  changedAt: number;
}

const FIELDS: Array<{ key: keyof GameConfig; label: string; numeric: boolean }> = [
  { key: 'matchDurationMs', label: 'Match duration (ms)', numeric: true },
  { key: 'readyCountdownMs', label: 'Ready countdown (ms)', numeric: true },
  { key: 'roundMemorizeMs', label: 'Round memorize time (ms)', numeric: true },
  { key: 'roundAnswerMs', label: 'Round answer window (ms)', numeric: true },
  { key: 'lobbyReadyTimeoutMs', label: 'Ready-check timeout (ms)', numeric: true },
  { key: 'reconnectGraceMs', label: 'Reconnect grace window (ms)', numeric: true },
  { key: 'correctScoreDelta', label: 'Correct answer score', numeric: true },
  { key: 'wrongPenaltyDelta', label: 'Wrong answer penalty', numeric: true },
];

export function GameConfigPage() {
  const { has } = useAuth();
  const { data, error, loading, reload } = usePolling<{ config: GameConfig; history: HistoryEntry[] }>('/admin/game/config');
  const [draft, setDraft] = useState<Partial<GameConfig>>({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function save() {
    if (!reason.trim() || Object.keys(draft).length === 0) return;
    setBusy(true);
    setSaveError(null);
    try {
      await api.put('/admin/game/config', { patch: draft, reason: reason.trim() });
      setDraft({});
      setReason('');
      reload();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Failed to save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="admin-page-title">Game Controls</h1>
      <p className="admin-page-sub">Server-authoritative — the player client can never override any of this. Every change requires a reason and is versioned below.</p>
      {error && <ErrorBox message={error} />}
      {loading && !data && <Loading />}
      {data && (
        <div className="admin-panel">
          <div className="admin-panel__title">Current configuration</div>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Setting</th>
                <th>Current value</th>
                {has('game.config.edit') && <th>New value</th>}
              </tr>
            </thead>
            <tbody>
              {FIELDS.map((f) => (
                <tr key={f.key}>
                  <td>{f.label}</td>
                  <td>{String(data.config[f.key])}</td>
                  {has('game.config.edit') && (
                    <td>
                      <input
                        className="admin-input"
                        type="number"
                        placeholder={String(data.config[f.key])}
                        value={draft[f.key] === undefined ? '' : String(draft[f.key])}
                        onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value === '' ? undefined : Number(e.target.value) }))}
                        style={{ width: 120 }}
                      />
                    </td>
                  )}
                </tr>
              ))}
              <tr>
                <td>1v1 Duel enabled</td>
                <td>{String(data.config.duelEnabled)}</td>
                {has('game.config.edit') && (
                  <td>
                    <input type="checkbox" checked={draft.duelEnabled ?? data.config.duelEnabled} onChange={(e) => setDraft((d) => ({ ...d, duelEnabled: e.target.checked }))} />
                  </td>
                )}
              </tr>
              <tr>
                <td>1v1v1v1 Squad enabled</td>
                <td>{String(data.config.squadEnabled)}</td>
                {has('game.config.edit') && (
                  <td>
                    <input type="checkbox" checked={draft.squadEnabled ?? data.config.squadEnabled} onChange={(e) => setDraft((d) => ({ ...d, squadEnabled: e.target.checked }))} />
                  </td>
                )}
              </tr>
            </tbody>
          </table>

          {has('game.config.edit') && (
            <div style={{ marginTop: 16 }}>
              <input className="admin-input" style={{ width: '100%' }} placeholder="Reason for this change (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <button className="admin-btn admin-btn--sm" style={{ marginTop: 8 }} disabled={busy || !reason.trim() || Object.keys(draft).length === 0} onClick={save}>
                {busy ? 'Saving…' : 'Save changes'}
              </button>
              {saveError && <ErrorBox message={saveError} />}
            </div>
          )}
        </div>
      )}

      <div className="admin-panel">
        <div className="admin-panel__title">Change history</div>
        {data && data.history.length === 0 && <Empty>No configuration changes yet.</Empty>}
        {data && data.history.length > 0 && (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Field</th>
                <th>Previous</th>
                <th>New</th>
                <th>Changed by</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {data.history.map((h, i) => (
                <tr key={i}>
                  <td>{h.key}</td>
                  <td>{String(h.previousValue)}</td>
                  <td>{String(h.newValue)}</td>
                  <td>{h.changedByName}</td>
                  <td>{fmtTime(h.changedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
