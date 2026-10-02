/**
 * Server-side admin authentication + RBAC middleware. Every single admin route mounts
 * `requireAdmin` first (resolves the admin session cookie/bearer token into a real,
 * currently-active AdminAccount — never trusting anything client-supplied) and then
 * `requirePermission(...)` (checks the ROLE_PERMISSIONS matrix for that exact account's
 * role — never a role or permission read from the request itself). Hiding a button in the
 * admin UI is never treated as security; this middleware is the actual boundary.
 */
import type { NextFunction, Request, Response } from 'express';
import { resolveAdminSession } from './auth.js';
import { getAdmin } from './store.js';
import { roleHasPermission, type AdminAccount, type Permission } from './types.js';

export const ADMIN_SESSION_COOKIE = 'arena_admin_session';

declare module 'express-serve-static-core' {
  interface Request {
    admin?: AdminAccount;
  }
}

function extractTokens(req: Request): { bearer?: string; cookie?: string } {
  const authHeader = req.headers.authorization;
  const authorizationBearer = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined;
  const previewBearer = req.headers['x-arena-admin-session-token'];
  const bearer = authorizationBearer ?? (typeof previewBearer === 'string' ? previewBearer : undefined);
  const cookies = req.cookies as Record<string, string> | undefined;
  return { bearer, cookie: cookies?.[ADMIN_SESSION_COOKIE] };
}

/** Resolves the caller's admin identity from a verified server-side session — NEVER from
 * an `adminId`/`role` field in the body, query, or params. The cookie is primary and the
 * bearer is only a cookie-blocked-preview fallback; if both resolve, they must identify the
 * same admin so a stale token can never override a valid browser cookie. */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const { bearer, cookie } = extractTokens(req);
  const bearerAdminId = resolveAdminSession(bearer);
  const cookieAdminId = resolveAdminSession(cookie);
  const adminId = bearerAdminId && cookieAdminId && bearerAdminId !== cookieAdminId ? null : cookieAdminId ?? bearerAdminId;
  if (!adminId) {
    res.status(401).json({ error: 'Not authenticated as an admin' });
    return;
  }
  const admin = getAdmin(adminId);
  if (!admin || !admin.active) {
    res.status(401).json({ error: 'Admin session is no longer valid' });
    return;
  }
  req.admin = admin;
  next();
}

/** Returns middleware that 403s unless the authenticated admin's role grants ALL of the
 *  listed permissions. Always used after requireAdmin, and always re-checked per request —
 *  there is no client-cacheable "you have permission X" token that could go stale/forged. */
export function requirePermission(...permissions: Permission[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const admin = req.admin;
    if (!admin) {
      res.status(401).json({ error: 'Not authenticated as an admin' });
      return;
    }
    const missing = permissions.filter((p) => !roleHasPermission(admin.role, p));
    if (missing.length > 0) {
      res.status(403).json({ error: `Missing required permission(s): ${missing.join(', ')}` });
      return;
    }
    next();
  };
}
