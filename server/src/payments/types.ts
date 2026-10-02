import type { User } from '../types.js';

export const PAYMENT_ADAPTER_SLOTS = ['PAY-01', 'PAY-02', 'PAY-03', 'PAY-04', 'PAY-05', 'PAY-06', 'PAY-07', 'PAY-08', 'PAY-09', 'PAY-10'] as const;
// Built-in slots remain stable for existing routing history; newly created operational
// accounts use the same opaque string ID namespace and are never allowed to rewrite
// historical routing decisions.
export type PaymentAdapterId = string;
export type PaymentMethod = 'UPI' | 'CRYPTO';
export type PaymentOperation = 'DEPOSIT' | 'WITHDRAWAL';
export type PaymentCurrency = 'INR' | 'USDT';
export type PaymentEnvironment = 'TEST' | 'SANDBOX' | 'PRODUCTION';
export type AdapterLifecycleStatus = 'ACTIVE' | 'DISABLED' | 'MAINTENANCE' | 'DEGRADED' | 'ARCHIVED';
export type PaymentWorkflowStatus = 'AWAITING_PAYMENT' | 'PAYMENT_SUBMITTED' | 'AWAITING_VERIFICATION' | 'UNDER_REVIEW' | 'VERIFIED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED' | 'PROCESSING' | 'CONFIRMED';
export type AdapterHealthStatus = 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' | 'MAINTENANCE' | 'DISABLED';
export type RoutingStrategy = 'ROUND_ROBIN' | 'WEIGHTED' | 'PRIORITY' | 'LEAST_LOAD' | 'CAPACITY_BASED';
export type PaymentTransactionStatus = 'CREATED' | 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'EXPIRED' | 'CANCELLED' | 'REVERSED';
export type ProviderEventStatus = 'RECEIVED' | 'PROCESSING' | 'PROCESSED' | 'FAILED' | 'DUPLICATE_IGNORED';
export type ReconciliationStatus = 'MATCHED' | 'MISSING' | 'DUPLICATE' | 'MISMATCH' | 'PENDING_TOO_LONG' | 'UNKNOWN';

export interface PaymentLimits {
  minAmount: number;
  maxAmount: number;
  dailyLimit: number;
  monthlyLimit: number;
}

export interface PaymentAdapterConfig {
  adapterId: PaymentAdapterId;
  displayName: string;
  provider: string;
  method: PaymentMethod;
  currency: PaymentCurrency;
  asset?: string;
  network?: string;
  environment: PaymentEnvironment;
  status: AdapterLifecycleStatus;
  depositEnabled: boolean;
  withdrawalEnabled: boolean;
  minAmount: number;
  maxAmount: number;
  priority: number;
  routingWeight: number;
  capacity: number;
  healthStatus: AdapterHealthStatus;
  healthDetail?: string;
  lastHealthCheckAt: number | null;
  lastSuccessfulTransactionAt: number | null;
  lastFailedTransactionAt: number | null;
  successfulCount: number;
  failedCount: number;
  pendingCount: number;
  healthFailureAutoDisable: boolean;
  secretRef: string | null;
  configVersion: number;
  createdAt: number;
  updatedAt: number;
}

export interface PaymentConfig {
  routingStrategy: RoutingStrategy;
  allowPreCreationFailover: boolean;
  defaultCurrency: PaymentCurrency;
  platformFeeBps: number;
  withdrawalFeeFlat: number;
  depositLimits: PaymentLimits;
  withdrawalLimits: PaymentLimits;
  updatedAt: number;
  updatedBy: string | null;
  version: number;
}

export interface RoutingDecision {
  id: string;
  transactionId: string;
  adapterId: PaymentAdapterId;
  provider: string;
  routingStrategy: RoutingStrategy;
  routingReason: string;
  selectedAt: number;
  configurationVersion: number;
}

export interface PaymentFeeBreakdown {
  providerFee: number;
  platformFee: number;
  networkFee: number;
  totalFee: number;
  netAmount: number;
}

export interface PaymentTransaction {
  id: string;
  userId: string;
  operation: PaymentOperation;
  method: PaymentMethod;
  currency: PaymentCurrency;
  amount: number;
  fees: PaymentFeeBreakdown;
  status: PaymentTransactionStatus;
  adapterId: PaymentAdapterId;
  provider: string;
  environment: PaymentEnvironment;
  clientIdempotencyKey: string;
  providerReference: string | null;
  destinationMasked: string | null;
  asset: string | null;
  network: string | null;
  txHash: string | null;
  confirmations: number | null;
  instructions: PaymentInstructions | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  failureReason: string | null;
  verifiedAt: number | null;
  workflowStatus?: PaymentWorkflowStatus;
  workflowUpdatedAt?: number;
  proof?: PaymentProof | null;
  operatorReference?: string | null;
  ledgerTransactionIds: string[];
  correlationId: string;
}

export interface PaymentProof {
  amount: number;
  reference: string;
  paymentAt: number;
  evidenceReference?: string | null;
  submittedAt: number;
}

export interface PaymentInstructions {
  kind: 'UPI_INTENT' | 'CRYPTO_ADDRESS' | 'SANDBOX';
  label: string;
  value: string;
  expiresAt: number | null;
  safeMetadata: Record<string, string | number | boolean>;
}

export interface ProviderEvent {
  id: string;
  provider: string;
  providerEventId: string;
  eventType: string;
  receivedAt: number;
  processedAt: number | null;
  status: ProviderEventStatus;
  retryCount: number;
  error: string | null;
  transactionId: string | null;
  providerReference: string | null;
  rawHash: string;
}

export interface ReconciliationRecord {
  id: string;
  transactionId: string;
  provider: string;
  internalStatus: PaymentTransactionStatus;
  providerStatus: string | null;
  status: ReconciliationStatus;
  detail: string;
  checkedAt: number;
  resolvedAt: number | null;
  resolvedBy: string | null;
}

export interface PaymentRiskSignal {
  id: string;
  userId: string | null;
  transactionId: string | null;
  severity: 'INFO' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  kind: string;
  detail: string;
  createdAt: number;
  evidence: Record<string, string | number | boolean>;
}

export interface PaymentAuditEvent {
  id: string;
  actorType: 'PLAYER' | 'ADMIN' | 'SYSTEM' | 'PROVIDER';
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  reason: string | null;
  requestId: string;
  createdAt: number;
  result: 'SUCCESS' | 'FAILURE';
}

export interface PaymentStoreShape {
  adapters: PaymentAdapterConfig[];
  config: PaymentConfig;
  routingDecisions: RoutingDecision[];
  transactions: PaymentTransaction[];
  providerEvents: ProviderEvent[];
  reconciliationRecords: ReconciliationRecord[];
  riskSignals: PaymentRiskSignal[];
  auditEvents: PaymentAuditEvent[];
  routingCursors: Record<string, number>;
}

export interface CreatePaymentInput {
  user: User;
  amount: number;
  method: PaymentMethod;
  currency: PaymentCurrency;
  idempotencyKey: string;
  destination?: string;
  asset?: string;
  network?: string;
  requestId: string;
}

export interface PaymentProviderResult {
  providerReference: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  instructions: PaymentInstructions | null;
  providerFee: number;
  networkFee: number;
  failureReason?: string;
}

export interface ProviderWebhookResult {
  providerEventId: string;
  eventType: string;
  providerReference: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'EXPIRED' | 'CANCELLED' | 'REVERSED';
  amount: number;
  currency: PaymentCurrency;
  transactionId?: string;
  txHash?: string;
  confirmations?: number;
}

export interface PaymentAdapterContext {
  config: PaymentAdapterConfig;
  secret: string | null;
}

export interface PaymentAdapter {
  readonly provider: string;
  readonly supportedMethods: readonly PaymentMethod[];
  createDeposit(input: CreatePaymentInput, context: PaymentAdapterContext): Promise<PaymentProviderResult>;
  getDepositStatus(reference: string, context: PaymentAdapterContext): Promise<PaymentProviderResult>;
  createWithdrawal(input: CreatePaymentInput, context: PaymentAdapterContext): Promise<PaymentProviderResult>;
  getWithdrawalStatus(reference: string, context: PaymentAdapterContext): Promise<PaymentProviderResult>;
  verifyWebhook(rawBody: string, signature: string | undefined, context: PaymentAdapterContext): boolean;
  parseWebhook(rawBody: string): ProviderWebhookResult;
  healthCheck(context: PaymentAdapterContext): Promise<{ status: AdapterHealthStatus; detail: string }>;
  refund?(reference: string, amount: number, context: PaymentAdapterContext): Promise<PaymentProviderResult>;
}

export interface PaymentPublicTransaction extends Omit<PaymentTransaction, 'userId' | 'adapterId' | 'provider' | 'environment' | 'clientIdempotencyKey' | 'correlationId' | 'ledgerTransactionIds'> {
  adapterId?: never;
  provider?: never;
  environment?: never;
  clientIdempotencyKey?: never;
  correlationId?: never;
}

export function toPublicPaymentTransaction(transaction: PaymentTransaction): PaymentPublicTransaction {
  const { userId: _userId, adapterId: _adapterId, provider: _provider, environment: _environment, clientIdempotencyKey: _key, correlationId: _correlationId, ledgerTransactionIds: _ledgerTransactionIds, ...safe } = transaction;
  return safe;
}
