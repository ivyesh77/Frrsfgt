import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PaymentAdapterId } from '../payments/types.js';
import type { OperatorAuditEntry, OperatorNote, PaymentOperatorAccount } from './types.js';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const DATA_FILE = join(DATA_DIR, 'operator-store.json');
const DATA_FILE_TMP = join(DATA_DIR, 'operator-store.json.tmp');
interface OperatorDb { operators: Record<string, PaymentOperatorAccount>; audit: OperatorAuditEntry[]; notes: OperatorNote[]; }
function load(): OperatorDb {
  try {
    if (!existsSync(DATA_FILE)) return { operators: {}, audit: [], notes: [] };
    return { operators: {}, audit: [], notes: [], ...(JSON.parse(readFileSync(DATA_FILE, 'utf8')) as Partial<OperatorDb>) };
  } catch { return { operators: {}, audit: [], notes: [] }; }
}
function save(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_FILE_TMP, JSON.stringify(db, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(DATA_FILE_TMP, DATA_FILE);
}
let db = load();
export function getOperator(id: string): PaymentOperatorAccount | undefined { return db.operators[id]; }
export function findOperatorByUsernameKey(usernameKey: string): PaymentOperatorAccount | undefined { return Object.values(db.operators).find((operator) => operator.usernameKey === usernameKey); }
export function listOperators(): PaymentOperatorAccount[] { return Object.values(db.operators); }
export function upsertOperator(operator: PaymentOperatorAccount): void { db.operators[operator.id] = operator; save(); }
export function listOperatorAudit(operatorId?: string): OperatorAuditEntry[] { return db.audit.filter((entry) => !operatorId || entry.operatorId === operatorId); }
export function addOperatorAudit(entry: OperatorAuditEntry): void { db.audit.push(entry); if (db.audit.length > 20_000) db.audit = db.audit.slice(-20_000); save(); }
export function addOperatorNote(note: OperatorNote): void { db.notes.push(note); if (db.notes.length > 20_000) db.notes = db.notes.slice(-20_000); save(); }
export function listOperatorNotes(operatorId?: string, transactionId?: string): OperatorNote[] { return db.notes.filter((note) => (!operatorId || note.operatorId === operatorId) && (!transactionId || note.transactionId === transactionId)); }
export function assignOperatorAccounts(operatorId: string, accountIds: PaymentAdapterId[]): PaymentOperatorAccount | undefined {
  const operator = getOperator(operatorId); if (!operator) return undefined;
  operator.assignedPaymentAccountIds = [...new Set(accountIds)]; save(); return operator;
}
export function __resetOperatorStoreForTests(): void { db = { operators: {}, audit: [], notes: [] }; save(); }
