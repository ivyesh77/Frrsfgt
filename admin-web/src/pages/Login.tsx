import { useState, type FormEvent } from 'react';
import { useAuth } from '../AuthContext';

export function LoginPage() {
  const { login, error, clearError } = useAuth();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    clearError();
    setBusy(true);
    try {
      await login(name, password);
    } catch {
      // error already surfaced via context
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-login-shell">
      <div className="admin-login-card">
        <h1>
          Wager Arena <span style={{ color: 'var(--accent)' }}>Admin</span>
        </h1>
        <p>Internal operations center. Authorized staff only.</p>
        {error && <div className="admin-error">{error}</div>}
        <form onSubmit={onSubmit}>
          <label htmlFor="admin-name">Admin username</label>
          <input id="admin-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" required />
          <label htmlFor="admin-password">Password</label>
          <input id="admin-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          <button className="admin-btn" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
