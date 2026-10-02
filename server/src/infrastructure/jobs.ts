import { createHash } from 'node:crypto';
import { Queue, QueueEvents, Worker, type ConnectionOptions, type Job, type JobsOptions } from 'bullmq';
import { processProviderWebhook } from '../payments/webhooks.js';
import { checkDatabase } from './database.js';
import { runtimeConfig } from './runtimeConfig.js';

export const PAYMENT_WEBHOOK_QUEUE = 'payment-webhooks';
export const PAYMENT_RECONCILIATION_QUEUE = 'payment-reconciliation';
export const NOTIFICATION_QUEUE = 'notifications';

export interface ProviderWebhookJob {
  provider: string;
  rawBody: string;
  signature: string | null;
  receivedAt: string;
}

export interface DurableOperationalJob {
  dedupeKey: string;
  payload: Record<string, unknown>;
}

let webhookQueue: Queue<ProviderWebhookJob> | null = null;
const operationalQueues = new Map<string, Queue<DurableOperationalJob>>();
let queueEvents: QueueEvents | null = null;

function assertBullMq(): void {
  if (runtimeConfig.jobBackend !== 'bullmq') throw new Error('Durable BullMQ jobs are not enabled; inline jobs are forbidden in production');
  if (!runtimeConfig.redisUrl) throw new Error('REDIS_URL is required for BullMQ');
}

function redisConnection(): ConnectionOptions {
  assertBullMq();
  const parsed = new URL(runtimeConfig.redisUrl);
  const connection: ConnectionOptions = {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : undefined,
  };
  if (parsed.protocol === 'rediss:') connection.tls = {};
  return connection;
}

function getWebhookQueue(): Queue<ProviderWebhookJob> {
  if (!webhookQueue) webhookQueue = new Queue<ProviderWebhookJob>(PAYMENT_WEBHOOK_QUEUE, { connection: redisConnection(), prefix: process.env.JOB_QUEUE_PREFIX ?? 'wager-arena' });
  return webhookQueue;
}

function getOperationalQueue(queueName: string): Queue<DurableOperationalJob> {
  let queue = operationalQueues.get(queueName);
  if (!queue) {
    queue = new Queue<DurableOperationalJob>(queueName, { connection: redisConnection(), prefix: process.env.JOB_QUEUE_PREFIX ?? 'wager-arena' });
    operationalQueues.set(queueName, queue);
  }
  return queue;
}

export async function enqueueDurableOperationalJob(queueName: string, jobType: string, input: DurableOperationalJob): Promise<{ jobId: string }> {
  assertBullMq();
  const digest = createHash('sha256').update(`${queueName}\n${jobType}\n${input.dedupeKey}`).digest('hex');
  const jobId = `${jobType}-${digest}`;
  await getOperationalQueue(queueName).add(jobType, input, {
    jobId,
    attempts: Number(process.env.OPERATIONAL_JOB_ATTEMPTS ?? 8),
    backoff: { type: 'exponential', delay: Number(process.env.OPERATIONAL_JOB_BACKOFF_MS ?? 1_000) },
    removeOnComplete: { age: 7 * 24 * 60 * 60, count: 100_000 },
    removeOnFail: false,
  });
  return { jobId };
}

export const enqueueReconciliationJob = (input: DurableOperationalJob) => enqueueDurableOperationalJob(PAYMENT_RECONCILIATION_QUEUE, 'reconcile-payment', input);
export const enqueueStaleTransactionJob = (input: DurableOperationalJob) => enqueueDurableOperationalJob(PAYMENT_RECONCILIATION_QUEUE, 'expire-stale-transaction', input);
export const enqueueNotificationJob = (input: DurableOperationalJob) => enqueueDurableOperationalJob(NOTIFICATION_QUEUE, 'deliver-notification', input);
export const enqueueAlertJob = (input: DurableOperationalJob) => enqueueDurableOperationalJob('alerts', 'deliver-alert', input);

export async function enqueueProviderWebhook(input: ProviderWebhookJob): Promise<{ jobId: string }> {
  const digest = createHash('sha256').update(`${input.provider}\n${input.rawBody}`).digest('hex');
  const jobId = `webhook-${input.provider}-${digest}`;
  const options: JobsOptions = {
    jobId,
    attempts: Number(process.env.WEBHOOK_JOB_ATTEMPTS ?? 8),
    backoff: { type: 'exponential', delay: Number(process.env.WEBHOOK_JOB_BACKOFF_MS ?? 1_000) },
    removeOnComplete: { age: 7 * 24 * 60 * 60, count: 100_000 },
    removeOnFail: false,
  };
  await getWebhookQueue().add('provider-webhook', input, options);
  return { jobId };
}

export async function checkJobQueue(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  try {
    assertBullMq();
    if (!queueEvents) queueEvents = new QueueEvents(PAYMENT_WEBHOOK_QUEUE, { connection: redisConnection(), prefix: process.env.JOB_QUEUE_PREFIX ?? 'wager-arena' });
    await queueEvents.waitUntilReady();
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - started, error: error instanceof Error ? error.message : 'queue check failed' };
  }
}

export async function createWebhookWorker(): Promise<Worker<ProviderWebhookJob>> {
  assertBullMq();
  // BullMQ workers must not give up on a Redis command while a job is owned by the worker;
  // the queue can retry/release it instead.
  const workerConnection = { ...redisConnection(), maxRetriesPerRequest: null };
  const worker = new Worker<ProviderWebhookJob>(PAYMENT_WEBHOOK_QUEUE, async (job: Job<ProviderWebhookJob>) => {
    await processProviderWebhook(job.data.provider, job.data.rawBody, job.data.signature ?? undefined);
  }, {
    connection: workerConnection,
    prefix: process.env.JOB_QUEUE_PREFIX ?? 'wager-arena',
    concurrency: Number(process.env.WEBHOOK_WORKER_CONCURRENCY ?? 10),
  });
  worker.on('failed', (job, error) => console.error(JSON.stringify({ level: 'error', event: 'job.failed', queue: PAYMENT_WEBHOOK_QUEUE, jobId: job?.id, attemptsMade: job?.attemptsMade, message: error.message })));
  return worker;
}

export async function closeJobInfrastructure(): Promise<void> {
  await webhookQueue?.close();
  await Promise.all([...operationalQueues.values()].map((queue) => queue.close()));
  await queueEvents?.close();
  webhookQueue = null;
  operationalQueues.clear();
  queueEvents = null;
}

/** Database and Redis are both readiness dependencies in a production deployment. The
 * database check is intentionally included here so callers can expose one dependency view. */
export async function checkDurableDependencies(): Promise<{ database: Awaited<ReturnType<typeof checkDatabase>>; queue: Awaited<ReturnType<typeof checkJobQueue>> }> {
  return { database: await checkDatabase(), queue: await checkJobQueue() };
}
