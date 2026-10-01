/**
 * Thin fetch wrapper for the admin API. Mirrors the player app's own api.ts pattern
 * (../../src/arena/api.ts) intentionally — same "cookie primary, in-memory bearer token
 * fallback" reasoning applies identically here (this app is also served through a
 * preview/iframe-capable tunnel in this environment) — but this is a completely
 * independent copy/implementation, not a shared import, per the "separate application"
 * requirement.
 */
// Mirrored into sessionStorage (never localStorage) for the identical reason documented in
// the player app's src/arena/api.ts: an in-memory-only token looks like a logout the moment
// an admin refreshes the page, even though their server-side session is still perfectly
// valid. Same properties as the player app's copy: scoped to this tab only, cleared when it
// closes, never a client-asserted identity (always re-validated via GET /admin/auth/me),
// and all storage access is try/catch guarded so private-browsing/disabled-storage just
// falls back to in-memory-only behavior instead of crashing the admin console.
const ADMIN_BEARER_STORAGE_KEY = 'arena_admin_session_token';

function readStoredAdminBearerToken(): string | null {
  try {
    return sessionStorage.getItem(ADMIN_BEARER_STORAGE_KEY);
  } catch {
    return null;
  }
}

let bearerToken: string | null = readStoredAdminBearerToken();
export function setBearerToken(token: string | null) {
  bearerToken = token;
  try {
    if (token) sessionStorage.setItem(ADMIN_BEARER_STORAGE_KEY, token);
    else sessionStorage.removeItem(ADMIN_BEARER_STORAGE_KEY);
  } catch {
    // Storage unavailable — in-memory token still works for this page's lifetime.
  }
}
export function getBearerToken() {
  return bearerToken;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const activeBearerToken = readStoredAdminBearerToken() ?? bearerToken;
  if (activeBearerToken) {
    headers.set('Authorization', `Bearer ${activeBearerToken}`);
    // Some preview/reverse-proxy layers rewrite or remove Authorization. The server
    // validates this second header as the same opaque admin session token; it is not an
    // admin identity claim and never contains a role or user-supplied id.
    headers.set('X-Arena-Admin-Session-Token', activeBearerToken);
  }
  const res = await fetch(path, { ...init, headers, credentials: 'include' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body?.error ?? `Request failed (${res.status})`, res.status);
  return body as T;
}

export const api = {
  get: <T,>(path: string) => request<T>(path),
  post: <T,>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T,>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
};
