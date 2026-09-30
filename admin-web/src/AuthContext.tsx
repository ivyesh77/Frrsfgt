import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setBearerToken } from './api';
import type { Permission, PublicAdmin } from './types';

interface AuthState {
  admin: PublicAdmin | null;
  permissions: Permission[];
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (name: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  has: (permission: Permission) => boolean;
  error: string | null;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ admin: null, permissions: [], loading: true });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ admin: PublicAdmin; permissions: Permission[] }>('/admin/auth/me')
      .then((res) => {
        if (!cancelled) setState({ admin: res.admin, permissions: res.permissions, loading: false });
      })
      .catch(() => {
        if (!cancelled) setState({ admin: null, permissions: [], loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (name: string, password: string) => {
    setError(null);
    try {
      const res = await api.post<{ admin: PublicAdmin; permissions: Permission[]; token: string }>('/admin/auth/login', { name, password });
      setBearerToken(res.token);
      setState({ admin: res.admin, permissions: res.permissions, loading: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
      throw err;
    }
  }, []);

  const logout = useCallback(async () => {
    await api.post('/admin/auth/logout').catch(() => {});
    setBearerToken(null);
    setState({ admin: null, permissions: [], loading: false });
  }, []);

  const has = useCallback((permission: Permission) => state.permissions.includes(permission), [state.permissions]);

  return <AuthContext.Provider value={{ ...state, login, logout, has, error, clearError: () => setError(null) }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
