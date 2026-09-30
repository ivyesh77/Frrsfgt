import { useState } from 'react';
import { api } from '../api';

interface SearchResults {
  users: Array<{ id: string; name: string; status: string }>;
  rooms: Array<{ id: string; status: string; format: string }>;
  transactions: Array<{ id: string; userId: string; type: string }>;
}

export function GlobalSearchBar() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [open, setOpen] = useState(false);

  async function runSearch(value: string) {
    setQ(value);
    if (value.trim().length < 2) {
      setResults(null);
      setOpen(false);
      return;
    }
    try {
      const res = await api.get<SearchResults>(`/admin/search?q=${encodeURIComponent(value)}`);
      setResults(res);
      setOpen(true);
    } catch {
      setResults(null);
    }
  }

  const totalResults = (results?.users.length ?? 0) + (results?.rooms.length ?? 0) + (results?.transactions.length ?? 0);

  return (
    <div className="admin-topbar__search" style={{ position: 'relative' }}>
      <input
        placeholder="Search users, rooms, transactions… (⌘K)"
        value={q}
        onChange={(e) => void runSearch(e.target.value)}
        onFocus={() => q.length >= 2 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && results && (
        <div
          style={{
            position: 'absolute',
            top: '110%',
            left: 0,
            right: 0,
            background: 'var(--bg-panel-2)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: 8,
            zIndex: 50,
            maxHeight: 320,
            overflowY: 'auto',
          }}
        >
          {totalResults === 0 && <div style={{ padding: 8, color: 'var(--text-faint)', fontSize: 12.5 }}>No matches — results are filtered to what your role can see.</div>}
          {results.users.length > 0 && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', padding: '4px 6px' }}>USERS</div>
              {results.users.map((u) => (
                <div key={u.id} style={{ padding: '6px 8px', fontSize: 13 }}>
                  {u.name} <span style={{ color: 'var(--text-faint)' }}>({u.status})</span>
                </div>
              ))}
            </div>
          )}
          {results.rooms.length > 0 && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', padding: '4px 6px' }}>ROOMS</div>
              {results.rooms.map((r) => (
                <div key={r.id} style={{ padding: '6px 8px', fontSize: 13 }}>
                  {r.id} <span style={{ color: 'var(--text-faint)' }}>({r.format}, {r.status})</span>
                </div>
              ))}
            </div>
          )}
          {results.transactions.length > 0 && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', padding: '4px 6px' }}>TRANSACTIONS</div>
              {results.transactions.map((t) => (
                <div key={t.id} style={{ padding: '6px 8px', fontSize: 13 }}>
                  {t.id} <span style={{ color: 'var(--text-faint)' }}>({t.type})</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
