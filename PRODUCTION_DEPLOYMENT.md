# Production deployment contract

This document describes the deployment shape required by the production code. The current checkout intentionally fails closed when `APP_ENV=STAGING` or `APP_ENV=PRODUCTION` is configured without the durable adapters below. It must not be deployed with the local JSON stores or inline jobs.

## Services

1. Player API and Socket.IO process.
2. Admin API process.
3. Payment Operator API process.
4. Player web app.
5. Super Admin web app.
6. Payment Operator web app.
7. PostgreSQL primary database.
8. Redis for shared sessions, distributed rate limits and BullMQ.
9. Payment webhook/reconciliation worker.
10. Metrics/log/alert collection.

The three API surfaces may share a release image, but the player, admin and operator HTTP namespaces and session principals remain isolated.

## Required configuration

Use `server/.env.example` as the shape only. Populate secrets through the deployment secret manager, not Git, frontend builds, JSON files or normal API responses.

Required in STAGING and PRODUCTION:

```text
APP_ENV=STAGING|PRODUCTION
STORAGE_BACKEND=postgres
DATABASE_URL=postgresql://...
SESSION_BACKEND=redis|postgres
REDIS_URL=rediss://...
JOB_BACKEND=bullmq
ALLOWED_ORIGINS=https://player.example,https://admin.example,https://operator.example
AUTH_BEARER_FALLBACK=0
METRICS_AUTH_TOKEN=<secret-manager value>
DB_SSL=require
```

Additional production requirements:

```text
PAYMENT_ENVIRONMENT=PRODUCTION
TRUSTED_PROXY_HOPS=<exact trusted proxy count>
JOB_QUEUE_PREFIX=wager-arena-production
```

`ADMIN_BOOTSTRAP_PASSWORD`, sandbox provider activation and `STORAGE_BACKEND=json` are rejected for production.

## Release order

1. Build and scan the exact release artifact.
2. Create or select the PostgreSQL database and private Redis instance.
3. Apply migrations:

   ```bash
   cd server
   APP_ENV=STAGING DATABASE_URL=... npm run migrate
   ```

4. Run readiness checks before receiving traffic:
   - `/health/ready`
   - `/admin/health/ready`
   - `/operator/health/ready`
5. Start the worker:

   ```bash
   APP_ENV=STAGING STORAGE_BACKEND=postgres SESSION_BACKEND=redis JOB_BACKEND=bullmq REDIS_URL=... DATABASE_URL=... npm run worker
   ```

6. Start API processes only after migrations and dependencies are ready.
7. Route traffic through TLS termination with an exact trusted-proxy configuration.
8. Enable only provider accounts whose official adapter, credentials, webhook signature contract, limits and compliance approvals are installed.

## Database integrity

`server/migrations/001_production_schema.sql` contains the initial production contract for users, sessions, rooms, matches, game sessions, wallets, ledger entries, payment accounts, payment transactions, routing decisions, provider events, reconciliation, admins, operators, assignments, audit events, notifications and durable jobs.

Financial writes must be implemented through PostgreSQL transactions with row locks on the wallet record and unique idempotency/provider-event constraints. A migration is not complete merely because the tables exist: the application repository calls must be moved from the JSON modules to the PostgreSQL repository before production traffic is permitted. The runtime guard currently prevents the unsafe JSON path from booting in STAGING/PRODUCTION.

## Session and queue requirements

- Player, admin and operator session rows must be stored in the shared session backend and hashed at rest.
- Logout and force invalidation must revoke rows/keys, not only process memory.
- Session rotation must be tested across two API instances.
- BullMQ webhook jobs use deterministic job IDs, retry with exponential backoff, and retain failed jobs for dead-letter investigation.
- Reconciliation, stale-payment, notifications and alert jobs must use the same durable queue contract; no timer in a web process is a production scheduler.

## Secret and provider policy

Provider secret references may be stored, but secret values must come from the deployment secret manager or an equivalent protected runtime injection. Operators receive platform credentials only. No consumer-bank login, scraping, private key or seed phrase is supported.

The sandbox adapter is TEST-only. An official adapter must be installed separately for each provider and must implement create/status/webhook verification, supported withdrawal/refund capabilities and health checks. Provider configuration must specify TEST, STAGING or PRODUCTION and cannot be silently promoted.

## Backup and recovery

Before go-live, define and test:

- encrypted PostgreSQL backups and point-in-time recovery;
- Redis persistence/HA policy appropriate for sessions and queues;
- queue replay/dead-letter procedure;
- payment-provider event replay procedure;
- ledger checksum and reconciliation checks;
- restore validation in an isolated environment;
- RPO/RTO, incident ownership and audit retention.

A successful backup command without a tested restore is not recovery evidence.

## Observability

Collect structured logs and metrics for API latency/errors, authentication failures, database/Redis/readiness, queue depth/failures, provider/webhook failures, payment backlogs, reconciliation mismatches, matchmaking failures and suspicious authorization attempts. Redact passwords, tokens, cookies, provider secrets and private keys.

## Go-live gate

The platform remains **NO-GO** until the PostgreSQL repositories are wired to all authoritative stores, shared session and queue processing is exercised across multiple instances, official providers and compliance approvals are available, and browser/concurrency/failure-recovery tests pass.
