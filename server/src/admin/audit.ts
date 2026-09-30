/** Every sensitive admin action funnels through this single function to produce an
 *  immutable audit record — there is no route in server.ts for editing or deleting an
 *  audit entry once written; the only mutation this module exposes is `append`. */
import { nanoid } from 'nanoid';
import { appendAuditEntry } from './store.js';
import type { AdminAccount, AuditEntry } from './types.js';

export function writeAudit(params: {
  admin: AdminAccount;
  action: string;
  targetKind: string;
  targetId: string | null;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
  result: 'success' | 'failure';
  errorMessage?: string | null;
  requestId: string;
}): AuditEntry {
  const entry: AuditEntry = {
    id: nanoid(14),
    timestamp: Date.now(),
    adminId: params.admin.id,
    adminName: params.admin.name,
    role: params.admin.role,
    action: params.action,
    targetKind: params.targetKind,
    targetId: params.targetId,
    reason: params.reason ?? null,
    before: params.before ?? null,
    after: params.after ?? null,
    result: params.result,
    errorMessage: params.errorMessage ?? null,
    requestId: params.requestId,
  };
  appendAuditEntry(entry);
  return entry;
}
