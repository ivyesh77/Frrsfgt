import type { PaymentAdapterId } from '../payments/types.js';

export type OperatorStatus = 'ACTIVE' | 'DISABLED';

export interface PaymentOperatorAccount {
  id: string;
  usernameKey: string;
  name: string;
  passwordHash: string;
  assignedPaymentAccountIds: PaymentAdapterId[];
  status: OperatorStatus;
  createdAt: number;
  createdBy: string | null;
  lastLoginAt: number | null;
}

export interface PublicPaymentOperator {
  id: string;
  name: string;
  assignedPaymentAccountIds: PaymentAdapterId[];
  status: OperatorStatus;
  createdAt: number;
  lastLoginAt: number | null;
}

export interface OperatorAuditEntry {
  id: string;
  operatorId: string;
  action: string;
  transactionId: string | null;
  adapterId: PaymentAdapterId | null;
  reason: string;
  requestId: string;
  createdAt: number;
  result: 'SUCCESS' | 'FAILURE';
}

export interface OperatorNote {
  id: string;
  operatorId: string;
  transactionId: string;
  adapterId: PaymentAdapterId;
  note: string;
  createdAt: number;
}
