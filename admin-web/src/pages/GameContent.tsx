import { api, ApiError } from '../api';
import { usePolling } from '../hooks';
import { Badge, ErrorBox, Loading } from '../components/ui';
import { useAuth } from '../AuthContext';
import { useState } from 'react';

interface GameAsset {
  id: string;
  category: string;
  active: boolean;
  tags: string[];
}

export function GameContentPage() {
  const { has } = useAuth();
  const { data, error, loading, reload } = usePolling<{ assets: GameAsset[] }>('/admin/game/content');
  const [actionError, setActionError] = useState<string | null>(null);

  async function toggle(assetId: string, active: boolean) {
    setActionError(null);
    try {
      await api.put(`/admin/game/content/${assetId}/active`, { active, reason: active ? 'Re-enabled via admin content screen' : 'Disabled via admin content screen' });
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to update asset');
    }
  }

  return (
    <div>
      <h1 className="admin-page-title">Game Content</h1>
      <p className="admin-page-sub">
        This build manages active/inactive state on top of a small, fixed bundled image set — there is no arbitrary file-upload pipeline yet. Disabling an asset immediately stops it
        from being selected as a target or distractor in any new round.
      </p>
      {error && <ErrorBox message={error} />}
      {actionError && <ErrorBox message={actionError} />}
      {loading && !data && <Loading />}
      {data && (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Asset</th>
              <th>Category</th>
              <th>Status</th>
              {has('game.content.edit') && <th>Action</th>}
            </tr>
          </thead>
          <tbody>
            {data.assets.map((a) => (
              <tr key={a.id}>
                <td>{a.id}</td>
                <td>{a.category}</td>
                <td>
                  <Badge tone={a.active ? 'green' : 'gray'}>{a.active ? 'active' : 'disabled'}</Badge>
                </td>
                {has('game.content.edit') && (
                  <td>
                    <button className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => toggle(a.id, !a.active)}>
                      {a.active ? 'Disable' : 'Enable'}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
