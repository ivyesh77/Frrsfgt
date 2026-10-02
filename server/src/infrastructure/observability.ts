import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry, prefix: 'wager_arena_' });

export const httpRequestsTotal = new Counter({ name: 'wager_arena_http_requests_total', help: 'HTTP requests handled', labelNames: ['surface', 'method', 'route', 'status'] as const, registers: [metricsRegistry] });
export const httpRequestDuration = new Histogram({ name: 'wager_arena_http_request_duration_seconds', help: 'HTTP request duration', labelNames: ['surface', 'method', 'route'] as const, buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5], registers: [metricsRegistry] });
export const authFailuresTotal = new Counter({ name: 'wager_arena_auth_failures_total', help: 'Authentication and authorization failures', labelNames: ['surface', 'reason'] as const, registers: [metricsRegistry] });
export const paymentEventsTotal = new Counter({ name: 'wager_arena_payment_events_total', help: 'Payment state and webhook events', labelNames: ['event', 'provider', 'status'] as const, registers: [metricsRegistry] });
export const jobFailuresTotal = new Counter({ name: 'wager_arena_job_failures_total', help: 'Durable job failures', labelNames: ['queue', 'job_type'] as const, registers: [metricsRegistry] });
export const queueWaitingJobs = new Gauge({ name: 'wager_arena_queue_waiting_jobs', help: 'Waiting durable jobs across monitored queues', registers: [metricsRegistry] });
export const reconciliationOpenRecords = new Gauge({ name: 'wager_arena_reconciliation_open_records', help: 'Open reconciliation records awaiting disposition', registers: [metricsRegistry] });
export const databasePoolWaitingClients = new Gauge({ name: 'wager_arena_database_pool_waiting_clients', help: 'Clients waiting for a PostgreSQL pool connection', registers: [metricsRegistry] });

export function setReconciliationOpenRecords(count: number): void {
  reconciliationOpenRecords.set(Math.max(0, count));
}

export function requestMetrics(surface: string) {
  return function recordRequest(method: string, route: string, status: number, durationMs: number): void {
    httpRequestsTotal.inc({ surface, method, route, status: String(status) });
    httpRequestDuration.observe({ surface, method, route }, durationMs / 1_000);
  };
}

export async function metricsText(): Promise<string> {
  return metricsRegistry.metrics();
}

export function structuredLog(level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown> = {}): void {
  const safe = { timestamp: new Date().toISOString(), level, event, ...fields };
  // Never pass raw request bodies, headers, cookies, tokens or provider credentials here.
  console.log(JSON.stringify(safe));
}
