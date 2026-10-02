import { randomBytes } from 'node:crypto';
import { nanoid } from 'nanoid';
import { hashPassword, normalizeUsername, verifyPassword } from '../auth.js';
import { findOperatorByUsernameKey, getOperator, upsertOperator } from './store.js';
import type { PaymentOperatorAccount, PublicPaymentOperator } from './types.js';

const TTL_MS = 12 * 60 * 60 * 1000;
const sessions = new Map<string, { operatorId: string; expiresAt: number }>();
export class OperatorInvalidCredentialsError extends Error { constructor() { super('Invalid operator username or password'); } }
export class OperatorDisabledError extends Error { constructor() { super('This operator account has been disabled'); } }
export function toPublicOperator(operator: PaymentOperatorAccount): PublicPaymentOperator { return { id: operator.id, name: operator.name, assignedPaymentAccountIds: operator.assignedPaymentAccountIds, status: operator.status, createdAt: operator.createdAt, lastLoginAt: operator.lastLoginAt }; }
export async function authenticateOperator(name: string, password: string): Promise<PaymentOperatorAccount> {
  const operator = findOperatorByUsernameKey(normalizeUsername(name));
  if (!operator) { await hashPassword(password); throw new OperatorInvalidCredentialsError(); }
  if (!(await verifyPassword(password, operator.passwordHash))) throw new OperatorInvalidCredentialsError();
  if (operator.status !== 'ACTIVE') throw new OperatorDisabledError();
  const updated = { ...operator, lastLoginAt: Date.now() };
  upsertOperator(updated); return updated;
}
export function createOperatorSession(operatorId: string): { token: string; expiresAt: number } { const token = randomBytes(32).toString('base64url'); const expiresAt = Date.now() + TTL_MS; sessions.set(token, { operatorId, expiresAt }); return { token, expiresAt }; }
export function resolveOperatorSession(token: string | undefined | null): string | null { if (!token) return null; const session = sessions.get(token); if (!session) return null; if (session.expiresAt < Date.now()) { sessions.delete(token); return null; } session.expiresAt = Date.now() + TTL_MS; return session.operatorId; }
export function destroyOperatorSession(token: string | undefined | null): void { if (token) sessions.delete(token); }
export function destroyAllOperatorSessionsForOperator(operatorId: string): void { for (const [token, session] of sessions) if (session.operatorId === operatorId) sessions.delete(token); }
export async function changeOwnOperatorPassword(operatorId: string, currentPassword: string, newPassword: string): Promise<PaymentOperatorAccount> {
  const operator = getOperator(operatorId);
  if (!operator) throw new Error('Operator account not found');
  if (!currentPassword || !(await verifyPassword(currentPassword, operator.passwordHash))) throw new Error('Current password is incorrect');
  if (newPassword.length < 12) throw new Error('Operator passwords must be at least 12 characters');
  const updated = { ...operator, passwordHash: await hashPassword(newPassword) };
  upsertOperator(updated);
  return updated;
}
export async function createOperatorAccount(name: string, password: string, createdBy: string, assignedPaymentAccountIds: PaymentOperatorAccount['assignedPaymentAccountIds'] = []): Promise<PaymentOperatorAccount> {
  if (name.trim().length < 2) throw new Error('Operator name must be at least 2 characters');
  if (password.length < 12) throw new Error('Operator passwords must be at least 12 characters');
  if (findOperatorByUsernameKey(normalizeUsername(name))) throw new Error('That operator name is already taken');
  const account: PaymentOperatorAccount = { id: `OP-${nanoid(12)}`, usernameKey: normalizeUsername(name), name: name.trim().slice(0, 40), passwordHash: await hashPassword(password), assignedPaymentAccountIds: [...new Set(assignedPaymentAccountIds)], status: 'ACTIVE', createdAt: Date.now(), createdBy, lastLoginAt: null };
  upsertOperator(account); return account;
}
export function operatorForSession(id: string): PaymentOperatorAccount | undefined { const operator = getOperator(id); return operator?.status === 'ACTIVE' ? operator : undefined; }
