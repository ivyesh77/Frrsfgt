# Production readiness task board

**Audit date:** 2026-10-02  
**Branch:** `arena/01a0f8e4-frrsfgt`  
**Decision:** **NO-GO for production and real-money operation.**

This board was created after reading `FINAL_PRODUCT_TASK_BOARD.md`, `SECURITY_FIX_REPORT.md`, `AUTH_SESSION_AUDIT_REPORT.md`, `AUTH_REAL_BROWSER_REPRO.md`, `PAYMENT_IMPLEMENTATION_STATUS.md`, `PAYMENT_IMPLEMENTATION_PLAN.md`, all server self-tests and the actual repository. Passing a self-test proves behavior in the current local process; it does not prove durability, multi-instance safety, provider settlement, recoverability or compliance.

Status meanings:

- **DONE** — implemented and verified at the stated boundary.
- **IN PROGRESS** — production architecture/code exists but still needs wiring, external infrastructure or acceptance evidence.
- **TODO** — not yet implemented.
- **BLOCKED** — cannot safely complete without external infrastructure, provider contracts, credentials or compliance decisions.

## Audit findings

| Area | Actual current state | Production conclusion |
|---|---|---|
| Player/game authority | Server-authoritative identity, room, score, timer, answer tokens, wallet and payment workflows exist. | Preserve; add durable room/game state before multi-instance operation. |
| Financial storage | `server/src/store.ts` and payment/admin/operator stores write atomic JSON files. | Not a production database, not safe for multiple writers/processes, no FK/row locks. |
| Sessions | Player uses an append-only local session journal; admin/operator use process-local maps. | Not a shared production session system. |
| Jobs | Webhooks and reconciliation are processed inline; timers and intervals live in API processes. | No durable retry, lease, dead-letter or restart recovery. |
| Payments | Adapter contract and sandbox adapter exist; official provider adapters intentionally fail closed. | No real payment can be enabled without provider integration and compliance. |
| RBAC/security | Namespaces, RBAC, assignment isolation, CSRF/session proof, rate limits and audit projections exist. | Requires distributed rate limiting, durable audit and multi-instance retest. |
| Observability | Security headers, health projections and local metrics code exist. | Needs central logs/metrics/alerts and dependency/readiness operation. |
| Browser E2E | Auth/session jsdom harness exists; real browser engine is unavailable in this environment. | Human/CI browser acceptance remains required. |

## P0 — production blockers

| ID | Task / acceptance | Status | Work/evidence |
|---|---|---|---|
| P0-01 | PostgreSQL authoritative repositories for users, rooms, matches, games, wallets, ledger, payments, admins, operators, audit and notifications. | IN PROGRESS / BLOCKED | Added `server/migrations/001_production_schema.sql`, `database.ts`, migration script and JSON production refusal. Existing domain modules still need conversion from synchronous JSON APIs to PostgreSQL repositories. |
| P0-02 | Atomic wallet/ledger/payment mutation with DB transactions, row locks and unique idempotency/provider constraints. | IN PROGRESS | Schema has wallet/ledger/payment constraints; application mutation paths still use local JSON in DEV/TEST. Must wire `withDatabaseTransaction` before production. |
| P0-03 | Shared durable sessions for player/admin/operator, hashed tokens, expiry, rotation, logout and cross-instance invalidation. | IN PROGRESS | Added Redis/Postgres durable session repository contract; current auth call paths still use file/process-local implementations outside production. Wire and run two-instance tests. |
| P0-04 | Durable webhook, reconciliation, stale-payment, notification and alert jobs with retry/backoff/lease/dead-letter. | IN PROGRESS | Added BullMQ webhook and operational queue contracts, deterministic job IDs, exponential retries, failed-job visibility and worker entrypoint. Settlement/reconciliation workers must be moved onto DB repositories. |
| P0-05 | Official provider adapter(s), verified webhook contracts and secure credential injection. | BLOCKED | Only sandbox and explicit unavailable adapters exist. Requires provider selection, contracts, credentials, secret manager and compliance approval. |
| P0-06 | Production environment must reject JSON, file sessions, inline jobs, bearer fallback and bootstrap credentials. | DONE | `runtimeConfig.ts` validates STAGING/PRODUCTION; JSON stores fail closed; production must specify PostgreSQL, Redis/Postgres sessions, BullMQ, origins, metrics auth and payment environment. |
| P0-07 | Production readiness endpoints must report database/session/queue dependency state. | DONE / IN PROGRESS | Added live/readiness endpoints to player/admin/operator APIs. Requires real PostgreSQL/Redis run to validate dependency behavior. |
| P0-08 | Backup, restore, migration, rollback and ledger-integrity procedure. | IN PROGRESS | Added `PRODUCTION_DEPLOYMENT.md` and `PRODUCTION_DATA_MIGRATION.md`; actual restore drill remains blocked until a production-like database exists. |
| P0-09 | Compliance/real-money controls: KYC/AML, age, jurisdiction, responsible use, tax/refund/chargeback/privacy and provider approval. | BLOCKED | External legal/provider inputs were not supplied. Live financial capability must remain disabled. |

## P1 — required hardening

| ID | Task / acceptance | Status | Work/evidence |
|---|---|---|---|
| P1-01 | Replace in-process HTTP rate limits with shared Redis limits in STAGING/PRODUCTION. | DONE in architecture | Added distributed `rate-limit-redis` stores to player/admin/operator limiters; requires Redis integration test. |
| P1-02 | Durable structured logs and central request/payment/job correlation. | IN PROGRESS | Added metrics and structured-log helpers; route-wide correlation/redaction and central exporter configuration remain. |
| P1-03 | Prometheus metrics for API, auth, payments and jobs; protected metrics endpoint. | DONE in code / IN PROGRESS operationally | Added `observability.ts` and `/metrics`; central scrape, retention and alert rules remain. |
| P1-04 | Webhook ingress acknowledges only after durable enqueue; worker verifies signature/schema/state before ledger mutation. | DONE in architecture | BullMQ path is selected by `JOB_BACKEND=bullmq`; provider verification remains in worker. Must be wired to PostgreSQL repositories. |
| P1-05 | Official provider refund/status/health capabilities and provider-specific schema tests. | BLOCKED | Requires official provider contracts. |
| P1-06 | Reconciliation compares provider, payment transaction, ledger and wallet and never silently repairs. | IN PROGRESS | Existing sandbox reconciliation/disposition works; durable scheduled reconciliation and financial correction workflow remain. |
| P1-07 | Game/matchmaking durability across restart and concurrent API instances. | TODO / BLOCKED | Current rooms/timers are process-local; requires persisted room/match state, leases and a realtime coordination design. |
| P1-08 | Durable audit trail with retention, tamper evidence and actor/request correlation. | TODO | Existing audit projection is append-only JSON development state; PostgreSQL audit repository and retention policy are required. |
| P1-09 | MFA/2FA-ready admin/operator authentication architecture and privileged-action confirmation. | TODO | Current password/session controls are present; MFA enrollment/challenge/recovery and step-up policy are not implemented. |
| P1-10 | Two-instance integration test: login on instance A, authenticated request/logout on instance B. | BLOCKED | Requires running shared PostgreSQL/Redis. |
| P1-11 | Concurrent financial mutation and provider-event tests against production database. | BLOCKED | Requires PostgreSQL repositories and a provider-like test harness. |
| P1-12 | Security header/CORS/secure-cookie/CSRF production retest using fixed origins and TLS. | IN PROGRESS | Existing reports cover local/preview; fixed-origin TLS browser test remains. |

## P2 — operational improvements

| ID | Task | Status |
|---|---|---|
| P2-01 | Provider outage, webhook backlog, withdrawal backlog, reconciliation mismatch, DB/queue failure and auth-abuse alerts. | TODO |
| P2-02 | SLO dashboards for API, WebSocket, queues, payment providers and matchmaking. | TODO |
| P2-03 | Centralized alert routing, ownership, escalation and runbooks. | TODO |
| P2-04 | Real-browser E2E for player, admin and operator surfaces in CI. | IN PROGRESS; local report says browser binary unavailable |
| P2-05 | Load/concurrency/soak testing with database locks and webhook bursts. | TODO |
| P2-06 | Failure testing: API restart, DB/Redis restart, worker crash, timeout, duplicate/delayed webhook and reconnect. | TODO |
| P2-07 | Interactive admin analytics/date ranges/charts and operator SLA reporting. | TODO |
| P2-08 | Restore drill, disaster recovery exercise and ledger checksum verification. | BLOCKED until production-like infra exists |

## P3 — future improvements

| ID | Task | Status |
|---|---|---|
| P3-01 | Multi-region deployment and regional failover. | TODO |
| P3-02 | Advanced fraud models and provider-specific risk signals. | TODO |
| P3-03 | Automated canary releases and feature-flagged provider rollout. | TODO |
| P3-04 | Full mobile/PWA offline experience with explicit financial-action restrictions. | TODO |
| P3-05 | Formal independent penetration test and compliance audit. | TODO / external |

## Dependency order executed in this pass

1. Audited existing reports, stores, sessions, queues, payment adapters, startup configuration and self-tests.
2. Added the production configuration contract and fail-closed JSON/file-storage guard.
3. Added PostgreSQL schema, transaction helper, migration runner and data migration/rollback documentation.
4. Added Redis/Postgres session repository contracts and distributed rate limiting support.
5. Added BullMQ durable webhook queue, worker entrypoint, retry/backoff/dead-letter retention and durable webhook ingress path.
6. Added metrics, structured logging helper and live/readiness checks for all three API surfaces.
7. Added explicit deployment, secret, backup and no-go documentation.
8. Re-ran TypeScript and all existing DEV/TEST self-tests.

## Current go/no-go

**NO-GO.** The repository now refuses to boot the unsafe JSON/file/inline path when configured as STAGING/PRODUCTION, but the PostgreSQL repositories, shared session wiring, DB-backed financial mutations, full durable job workers, official providers, external secret management and compliance controls are not yet available in this checkout. Keeping live financial operations disabled is the correct production behavior.
