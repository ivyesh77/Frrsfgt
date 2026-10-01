import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, setBearerToken } from './api';
import type { Permission, PublicAdmin } from './types';

interface AuthState {
  admin: PublicAdmin | null;
  permissions: Permission[];
  loading: boolean;
  /** Set only when the initial "are we already logged in?" check couldn't get a definitive
   *  answer after retrying (network error, or a non-401 server error) — see the player
   *  app's identical reasoning in src/arena/useArena.ts. A confirmed 401 clears this and
   *  shows the ordinary login screen; anything else must never be silently treated as
   *  "not logged in" or "logged in" — both would be a guess. */
  bootstrapError: string | null;
}

interface AuthContextValue extends AuthState {
  login: (name: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  has: (permission: Permission) => boolean;
  error: string | null;
  clearError: () => void;
  retryBootstrap: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ admin: null, permissions: [], loading: true, bootstrapError: null });
  const [error, setError] = useState<string | null>(null);
  const runIdRef = useRef(0);

  const runBootstrap = useCallback(() => {
    const runId = ++runIdRef.current;
    const backoffMs = [500, 1500, 3000];
    const attempt = (n: number) => {
      if (runIdRef.current !== runId) return;
      api
        .get<{ admin: PublicAdmin; permissions: Permission[] }>('/admin/auth/me')
        .then((res) => {
          if (runIdRef.current === runId) setState({ admin: res.admin, permissions: res.permissions, loading: false, bootstrapError: null });
        })
        .catch((err) => {
          if (runIdRef.current !== runId) return;
          // A clean, confirmed 401 is definitive — not logged in, no retry needed.
          if (err instanceof ApiError && err.status === 401) {
            setState({ admin: null, permissions: [], loading: false, bootstrapError: null });
            return;
          }
          // Anything else (network error, 403/429/500/502/503) is inconclusive — retry a
          // bounded number of times before surfacing an explicit connection-problem state.
          if (n < backoffMs.length) {
            window.setTimeout(() => attempt(n + 1), backoffMs[n]);
            return;
          }
          const message = err instanceof Error ? err.message : 'Could not reach the server';
          setState((prev) => ({ ...prev, loading: false, bootstrapError: message }));
        });
    };
    attempt(0);
  }, []);

  useEffect(() => {
    runBootstrap();
  }, [runBootstrap]);

  const retryBootstrap = useCallback(() => {
    setState((prev) => ({ ...prev, loading: true, bootstrapError: null }));
    runBootstrap();
  }, [runBootstrap]);

  const login = useCallback(async (name: string, password: string) => {
    setError(null);
    try {
      const res = await api.post<{ admin: PublicAdmin; permissions: Permission[]; token: string }>('/admin/auth/login', { name, password });
      setBearerToken(res.token);
      setState({ admin: res.admin, permissions: res.permissions, loading: false, bootstrapError: null });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
      throw err;
    }
  }, []);

  const logout = useCallback(async () => {
    await api.post('/admin/auth/logout').catch(() => {});
    setBearerToken(null);
    setState({ admin: null, permissions: [], loading: false, bootstrapError: null });
  }, []);

  const has = useCallback((permission: Permission) => state.permissions.includes(permission), [state.permissions]);

  return (
    <AuthContext.Provider value={{ ...state, login, logout, has, error, clearError: () => setError(null), retryBootstrap }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
