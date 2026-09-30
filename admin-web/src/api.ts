/**
 * Thin fetch wrapper for the admin API. Mirrors the player app's own api.ts pattern
 * (../../src/arena/api.ts) intentionally — same "cookie primary, in-memory bearer token
 * fallback" reasoning applies identically here (this app is also served through a
 * preview/iframe-capable tunnel in this environment) — but this is a completely
 * independent copy/implementation, not a shared import, per the "separate application"
 * requirement.
 */
let bearerToken: string | null = null;
export function setBearerToken(token: string | null) {
  bearerToken = token;
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
  if (bearerToken) headers.set('Authorization', `Bearer ${bearerToken}`);
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
