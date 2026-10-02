import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { nanoid } from 'nanoid';
import { getUser } from '../store.js';
import { getPaymentTransaction, listPaymentAdapters, listPaymentTransactions, listReconciliationRecords } from '../payments/store.js';
import { publicAdapter } from '../payments/registry.js';
import { resolveReconciliation, type ReconciliationResolution } from '../payments/reconciliation.js';
import { operatorConfirmWithdrawal, operatorProcessWithdrawal, operatorRejectPayment, operatorRequestPaymentInfo, operatorVerifyDeposit } from '../payments/workflow.js';
import type { PaymentAdapterId, PaymentTransaction } from '../payments/types.js';
import { authenticateOperator, changeOwnOperatorPassword, createOperatorSession, destroyAllOperatorSessionsForOperator, destroyOperatorSession, OperatorDisabledError, OperatorInvalidCredentialsError, operatorForSession, resolveOperatorSession, toPublicOperator } from './auth.js';
import { addOperatorAudit, addOperatorNote, listOperatorAudit, listOperatorNotes } from './store.js';

export const OPERATOR_SESSION_COOKIE = 'arena_operator_session';
export interface OperatorServerDeps { port?: number; }
function requestId(req: Request): string { const value = req.headers['x-request-id']; return typeof value === 'string' && value ? value : nanoid(12); }
function bearerFromRequest(req: Request): string | undefined { const auth = req.headers.authorization; if (auth?.startsWith('Bearer ')) return auth.slice(7); const preview = req.headers['x-arena-operator-session-token']; return typeof preview === 'string' ? preview : undefined; }
function operatorPublicTransaction(transaction: PaymentTransaction): Record<string, unknown> {
  const user = getUser(transaction.userId);
  return { ...transaction, userId: undefined, playerName: user?.name ?? 'Unknown player', adapter: publicAdapter(listPaymentAdapters().find((adapter) => adapter.adapterId === transaction.adapterId)!), proof: transaction.proof ?? null };
}
function assigned(operator: NonNullable<ReturnType<typeof operatorForSession>>, transaction: PaymentTransaction): boolean { return operator.assignedPaymentAccountIds.includes(transaction.adapterId); }
function assignedId(operator: NonNullable<ReturnType<typeof operatorForSession>>, adapterId: string): boolean { return operator.assignedPaymentAccountIds.includes(adapterId as PaymentAdapterId); }
function actionAudit(operator: NonNullable<ReturnType<typeof operatorForSession>>, action: string, transaction: PaymentTransaction | null, reason: string, req: Request, result: 'SUCCESS' | 'FAILURE'): void { addOperatorAudit({ id: `OPAUD-${nanoid(12)}`, operatorId: operator.id, action, transactionId: transaction?.id ?? null, adapterId: transaction?.adapterId ?? null, reason: reason.slice(0, 500), requestId: requestId(req), createdAt: Date.now(), result }); }

export function createOperatorApp(_deps: OperatorServerDeps = {}) {
  const app = express();
  const allowedOrigin = process.env.OPERATOR_ALLOWED_ORIGIN;
  app.use(cors({ origin: allowedOrigin ? allowedOrigin.split(',').map((origin) => origin.trim()) : false, credentials: true }));
  app.use((_req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'no-referrer'); next(); });
  app.use(express.json({ limit: '256kb' })); app.use(cookieParser());
  const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });
  function setCookie(res: Response, req: Request, token: string): void { const secure = process.env.NODE_ENV === 'production' || req.secure; res.cookie(OPERATOR_SESSION_COOKIE, token, { httpOnly: true, sameSite: process.env.NODE_ENV === 'production' ? 'lax' : secure ? 'none' : 'lax', secure, maxAge: 12 * 60 * 60 * 1000, path: '/' }); }
  function requireOperator(req: Request, res: Response, next: NextFunction): void {
    const bearer = bearerFromRequest(req); const cookie = (req.cookies as Record<string, string> | undefined)?.[OPERATOR_SESSION_COOKIE];
    const bearerId = resolveOperatorSession(bearer); const cookieId = resolveOperatorSession(cookie); const id = bearerId && cookieId && bearerId !== cookieId ? null : cookieId ?? bearerId; const operator = id ? operatorForSession(id) : undefined;
    if (!operator) { res.status(401).json({ error: 'Not authenticated as a payment operator' }); return; }
    res.locals.operator = operator; next();
  }
  function current(req: Request) { return resOperator(req); }
  function resOperator(req: Request) { return resOperatorFromLocals(req); }
  function resOperatorFromLocals(req: Request) { return req.res?.locals.operator as NonNullable<ReturnType<typeof operatorForSession>>; }
  function getAssignedTransaction(req: Request, res: Response): { operator: NonNullable<ReturnType<typeof operatorForSession>>; transaction: PaymentTransaction } | null {
    const operator = res.locals.operator as NonNullable<ReturnType<typeof operatorForSession>>; const transaction = getPaymentTransaction(req.params.id ?? '');
    if (!transaction || !assigned(operator, transaction)) { res.status(404).json({ error: 'Payment transaction not found' }); return null; }
    return { operator, transaction };
  }

  app.get('/operator/health', (_req, res) => res.json({ ok: true }));
  app.post('/operator/auth/login', loginLimiter, async (req, res) => {
    try { const operator = await authenticateOperator(typeof req.body?.name === 'string' ? req.body.name : '', typeof req.body?.password === 'string' ? req.body.password : ''); const { token } = createOperatorSession(operator.id); setCookie(res, req, token); res.json({ operator: toPublicOperator(operator), token }); }
    catch (error) { if (error instanceof OperatorInvalidCredentialsError) return res.status(401).json({ error: error.message }); if (error instanceof OperatorDisabledError) return res.status(403).json({ error: error.message }); res.status(400).json({ error: error instanceof Error ? error.message : 'Operator login failed' }); }
  });
  app.post('/operator/auth/logout', (req, res) => { const bearer = bearerFromRequest(req); const cookie = (req.cookies as Record<string, string> | undefined)?.[OPERATOR_SESSION_COOKIE]; destroyOperatorSession(bearer); if (cookie !== bearer) destroyOperatorSession(cookie); res.clearCookie(OPERATOR_SESSION_COOKIE, { path: '/' }); res.json({ ok: true }); });
  app.get('/operator/auth/me', requireOperator, (_req, res) => res.json({ operator: toPublicOperator(res.locals.operator) }));
  app.post('/operator/auth/change-password', requireOperator, loginLimiter, async (req, res) => {
    const operator = current(req);
    const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new password are required' });
    try {
      const updated = await changeOwnOperatorPassword(operator.id, currentPassword, newPassword);
      destroyAllOperatorSessionsForOperator(operator.id);
      const { token } = createOperatorSession(operator.id);
      setCookie(res, req, token);
      res.json({ ok: true, operator: toPublicOperator(updated), token });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to change operator password' });
    }
  });

  app.get('/operator/dashboard', requireOperator, (req, res) => {
    const operator = current(req); const transactions = listPaymentTransactions().filter((transaction) => assigned(operator, transaction)); const today = new Date(); today.setHours(0, 0, 0, 0); const todayTransactions = transactions.filter((transaction) => transaction.createdAt >= today.getTime());
    const summarize = (operation: PaymentTransaction['operation']) => { const rows = todayTransactions.filter((transaction) => transaction.operation === operation); return { total: rows.length, volume: rows.reduce((sum, transaction) => sum + transaction.amount, 0), pending: rows.filter((transaction) => !['COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED', 'REVERSED'].includes(transaction.status)).length, completed: rows.filter((transaction) => transaction.status === 'COMPLETED').length, failed: rows.filter((transaction) => ['FAILED', 'EXPIRED', 'CANCELLED', 'REVERSED'].includes(transaction.status)).length }; };
    res.json({ operator: toPublicOperator(operator), accounts: operator.assignedPaymentAccountIds.map((id) => { const adapter = listPaymentAdapters().find((entry) => entry.adapterId === id); return adapter ? publicAdapter(adapter) : null; }).filter(Boolean), deposits: summarize('DEPOSIT'), withdrawals: summarize('WITHDRAWAL'), alerts: transactions.filter((transaction) => transaction.workflowStatus === 'UNDER_REVIEW' || transaction.status === 'FAILED').slice(-20).map(operatorPublicTransaction) });
  });
  app.get('/operator/payment-accounts', requireOperator, (req, res) => { const operator = current(req); res.json({ accounts: listPaymentAdapters().filter((adapter) => assignedId(operator, adapter.adapterId)).map(publicAdapter) }); });
  app.get('/operator/deposits', requireOperator, (req, res) => { const operator = current(req); const rows = listPaymentTransactions({ operation: 'DEPOSIT' }).filter((transaction) => assigned(operator, transaction)).sort((a, b) => b.createdAt - a.createdAt); res.json({ rows: rows.map(operatorPublicTransaction), total: rows.length }); });
  app.get('/operator/withdrawals', requireOperator, (req, res) => { const operator = current(req); const rows = listPaymentTransactions({ operation: 'WITHDRAWAL' }).filter((transaction) => assigned(operator, transaction)).sort((a, b) => b.createdAt - a.createdAt); res.json({ rows: rows.map(operatorPublicTransaction), total: rows.length }); });
  app.get('/operator/transactions/:id', requireOperator, (req, res) => { const match = getAssignedTransaction(req, res); if (!match) return; res.json({ transaction: operatorPublicTransaction(match.transaction), notes: listOperatorNotes(match.operator.id, match.transaction.id), audit: listOperatorAudit(match.operator.id).filter((entry) => entry.transactionId === match.transaction.id), reconciliation: listReconciliationRecords(match.transaction.id) }); });
  app.get('/operator/reconciliation', requireOperator, (req, res) => { const operator = current(req); const accountIds = new Set(operator.assignedPaymentAccountIds); const records = listReconciliationRecords().filter((record) => { const transaction = getPaymentTransaction(record.transactionId); return transaction && accountIds.has(transaction.adapterId); }); res.json({ records: records.slice().reverse() }); });
  app.post('/operator/reconciliation/:id/resolve', requireOperator, (req, res) => {
    const operator = current(req);
    const record = listReconciliationRecords().find((entry) => entry.id === req.params.id);
    const transaction = record ? getPaymentTransaction(record.transactionId) : undefined;
    if (!record || !transaction || !assigned(operator, transaction)) return res.status(404).json({ error: 'Reconciliation record not found' });
    const resolution = req.body?.resolution as ReconciliationResolution;
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    if (!['ACKNOWLEDGED', 'ESCALATED'].includes(resolution)) return res.status(400).json({ error: 'Operators may acknowledge or escalate reconciliation records only' });
    if (note.length < 5 || note.length > 1000) return res.status(400).json({ error: 'Resolution note must be 5-1000 characters' });
    try {
      const updated = resolveReconciliation(record.id, operator.id, resolution, note);
      actionAudit(operator, 'RESOLVE_RECONCILIATION', transaction, note, req, 'SUCCESS');
      res.json({ ok: true, record: updated });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Reconciliation resolution failed';
      actionAudit(operator, 'RESOLVE_RECONCILIATION', transaction, message, req, 'FAILURE');
      res.status(400).json({ error: message });
    }
  });
  app.get('/operator/notifications', requireOperator, (req, res) => { const operator = current(req); const transactions = listPaymentTransactions().filter((transaction) => assigned(operator, transaction)); res.json({ notifications: transactions.filter((transaction) => transaction.workflowStatus === 'UNDER_REVIEW' || transaction.status === 'FAILED').slice(-50).map((transaction) => ({ id: `PAYALERT-${transaction.id}`, transactionId: transaction.id, adapterId: transaction.adapterId, title: transaction.workflowStatus === 'UNDER_REVIEW' ? 'Payment requires review' : 'Payment failed', createdAt: transaction.updatedAt })) }); });

  async function workflowAction(req: Request, res: Response, action: string, fn: (transaction: PaymentTransaction, reason: string, operator: NonNullable<ReturnType<typeof operatorForSession>>) => PaymentTransaction): Promise<void> {
    const match = getAssignedTransaction(req, res); if (!match) return; const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : ''; if (!reason) { actionAudit(match.operator, action, match.transaction, 'Missing reason', req, 'FAILURE'); res.status(400).json({ error: 'A reason is required' }); return; }
    try { const updated = fn(match.transaction, reason, match.operator); actionAudit(match.operator, action, updated, reason, req, 'SUCCESS'); res.json({ ok: true, transaction: operatorPublicTransaction(updated) }); } catch (error) { actionAudit(match.operator, action, match.transaction, error instanceof Error ? error.message : 'Workflow action failed', req, 'FAILURE'); res.status(400).json({ error: error instanceof Error ? error.message : 'Workflow action failed' }); }
  }
  app.post('/operator/transactions/:id/request-info', requireOperator, async (req, res) => workflowAction(req, res, 'REQUEST_INFO', (transaction, reason) => operatorRequestPaymentInfo(transaction, reason)));
  app.post('/operator/transactions/:id/verify', requireOperator, async (req, res) => workflowAction(req, res, 'VERIFY_DEPOSIT', (transaction, reason) => operatorVerifyDeposit(transaction, reason)));
  app.post('/operator/transactions/:id/reject', requireOperator, async (req, res) => workflowAction(req, res, 'REJECT_PAYMENT', (transaction, reason) => operatorRejectPayment(transaction, reason)));
  app.post('/operator/transactions/:id/process', requireOperator, async (req, res) => workflowAction(req, res, 'PROCESS_WITHDRAWAL', (transaction, reason) => operatorProcessWithdrawal(transaction, typeof req.body?.operatorReference === 'string' ? req.body.operatorReference : '', reason)));
  app.post('/operator/transactions/:id/confirm', requireOperator, async (req, res) => workflowAction(req, res, 'CONFIRM_WITHDRAWAL', (transaction, reason) => operatorConfirmWithdrawal(transaction, reason)));
  app.post('/operator/transactions/:id/notes', requireOperator, (req, res) => { const match = getAssignedTransaction(req, res); if (!match) return; const note = typeof req.body?.note === 'string' ? req.body.note.trim() : ''; if (note.length < 2 || note.length > 1000) return res.status(400).json({ error: 'Note must be 2-1000 characters' }); addOperatorNote({ id: `OPNOTE-${nanoid(12)}`, operatorId: match.operator.id, transactionId: match.transaction.id, adapterId: match.transaction.adapterId, note, createdAt: Date.now() }); actionAudit(match.operator, 'ADD_NOTE', match.transaction, note, req, 'SUCCESS'); res.status(201).json({ ok: true }); });
  return app;
}

export async function startOperatorServer(deps: OperatorServerDeps = {}): Promise<ReturnType<ReturnType<typeof createOperatorApp>['listen']>> {
  const port = deps.port ?? (Number(process.env.OPERATOR_PORT) || 8789);
  const app = createOperatorApp(deps);
  return new Promise((resolve) => { const server = app.listen(port, '0.0.0.0', () => { console.log(`Payment operator portal listening on :${port}`); resolve(server); }); });
}
