# Payment Adapter + Routing + Deposit/Withdrawal Implementation Plan

Date: 2026-10-02
Branch: `arena/01a0f8e4-frrsfgt`

## Phase 0 — Repository audit

### Existing components

| Area | Current implementation | Classification | Decision |
|---|---|---|---|
| Player authentication/session | `server/src/auth.ts`, `server/src/sessionStore.ts`, `server/src/index.ts`, `src/arena/api.ts`, `src/arena/authStore.ts` | Server-authoritative, session based; recent preview bearer fallback is server-validated | Preserve; payment routes use the existing player namespace and `req.userId` only |
| Player wallet | `server/src/wallet.ts` | In-memory/file-backed practice-currency balance with synchronous ledger writes | Preserve as the wallet authority; add narrowly-scoped payment reservation/credit/release functions |
| Existing ledger/transactions | `server/src/store.ts`, `server/src/types.ts` | Existing `Transaction` records and wallet mutation functions | Reuse; extend records with optional payment trace metadata rather than creating a second wallet ledger |
| Player deposit/withdraw | `/api/wallet/topup`, `/api/wallet/withdraw` in `server/src/index.ts` and `wallet.ts` | Demo/practice-currency operations; synchronous; no provider settlement | Keep explicit demo behavior, add a separate real payment lifecycle API; do not silently reinterpret old demo routes |
| Payment configuration | `server/src/admin/payments.ts`, `server/src/admin/store.ts`, `server/src/admin/types.ts` | Honest UPI/crypto configuration scaffold; no provider calls or provider-backed transactions | Replace the configuration-only path with the new adapter registry while preserving compatible read projections |
| Provider integrations | None | Not production-ready; no official UPI/crypto provider is wired | Implement provider-independent interfaces and disabled/test sandbox adapters only; no fabricated real-money provider claim |
| Webhooks | Admin-only in-memory/file-backed event intake helper | Partial scaffold; no public signed endpoint or transaction settlement | Replace with signed, idempotent provider webhook ingestion |
| Reconciliation | `computeReconciliation()` compares practice topups to admin webhook records | Partial and honest, but not payment-transaction aware | Replace with transaction/provider status reconciliation records |
| Admin auth/RBAC | `server/src/admin/*`, separate admin port/session namespace | Existing server-enforced roles and append-only audit log | Preserve; add payment-specific permissions and audit events |
| Admin UI | `admin-web/src/pages/Providers.tsx`, `Upi.tsx`, `Crypto.tsx`, `Webhooks.tsx`, `Reconciliation.tsx`, wallet/transactions/analytics pages | Configuration/visibility only; no adapter registry or transaction detail lifecycle | Extend with payment accounts, detail, routing, transaction trace and operations actions |
| Notifications | `server/src/notifications.ts` | Server-created player notifications, persisted with player state | Reuse for authoritative payment state notifications |
| Risk/events/rate limits | `server/src/admin/signals.ts`, `server/src/rateLimit.ts`, route limiters | Existing signals and basic limits | Add payment-specific velocity/risk signals and stronger mutation/webhook limits |
| Persistence | Atomic JSON files under `server/data` | No relational database, migrations, FK engine, or external queue | Use atomic payment-store JSON with references/indexes appropriate to this repository; document that multi-process production DB migration remains required |
| Environment/secrets | Environment variables and `.gitignore` | No secret manager integration | Store secret references only; resolve HMAC/provider secrets from deployment environment. Real adapters remain disabled without compliant provider configuration |
| Realtime | Socket.IO game events | Authenticated player socket, not a payment transport | Do not put financial authority in realtime events; payment UI polls authoritative HTTP status |

### Audit conclusion

The existing wallet ledger is the only wallet authority and must not be duplicated. The current `topup`/`withdraw` routes are explicitly demo-currency operations, not provider operations. The implementation below adds a separate payment transaction engine which settles into the existing ledger only after a verified provider result. A deterministic sandbox adapter is included for tests and local end-to-end verification; real UPI and crypto provider adapters are not enabled because no official provider credentials, legal entity/compliance inputs, KYC/AML policy, webhook contracts, or jurisdiction configuration were supplied.

## Phase 1 — Master task list

Each item includes dependency, implementation files, test, and acceptance criteria. The checkboxes are updated only after the corresponding verification is run.

### P0 — Security / financial integrity

- [ ] **P0-01 Payment trust boundary** — Depends: audit. Files: `server/src/payments/types.ts`, `service.ts`, player routes. Implement server-derived user, amount, fee, status, provider and routing; reject client adapter/status/fee/owner overrides. Test forged-field requests. Accept: no client field can directly mutate balance or final transaction state.
- [ ] **P0-02 Idempotency and replay protection** — Depends: P0-01. Files: payment store/service/webhook service. Implement user-operation idempotency key, provider event uniqueness, transaction reference uniqueness. Test sequential and concurrent duplicates. Accept: one financial effect per mutation/event.
- [ ] **P0-03 Withdrawal reservation safety** — Depends: existing wallet ledger/P0-02. Files: `server/src/wallet.ts`, `store.ts`, payment service. Implement synchronous reservation, release, completion and insufficient-funds checks. Test concurrent duplicate withdrawals. Accept: no negative balance or lost funds.
- [ ] **P0-04 Secret boundary** — Depends: adapter interface. Files: `secrets.ts`, admin routes/UI. Implement secret references/environment resolver, configured-state projection only. Test API/UI never returns secret values. Accept: no raw secret in JSON, frontend bundle, or persisted config.
- [ ] **P0-05 Permissions and audit** — Depends: existing admin RBAC. Files: admin types/server/audit. Add `PAYMENT_VIEW`, `PAYMENT_CONFIG`, `PAYMENT_OPERATE`, `PAYMENT_RECONCILE`, `PAYMENT_ADJUST`, `PAYMENT_ADMIN`; require reason for sensitive actions. Test every role and unauthorised player access. Accept: server enforcement and immutable audit trail.
- [ ] **P0-06 State machine** — Depends: payment types/store. Validate every payment state transition, including reversal rules. Test illegal transitions. Accept: no arbitrary “mark success” endpoint.

### P1 — Core payment engine

- [ ] **P1-01 Provider-independent adapter contract** — Depends: P0-01. Files: `adapter.ts`, `adapters/*`. Implement create/status/webhook/signature/health/refund capability methods. Test capability boundaries. Accept: wallet code does not hardcode a provider.
- [ ] **P1-02 Adapter registry and persistent config** — Depends: P0-04/P1-01. Files: `paymentStore.ts`, `registry.ts`, admin APIs. Support 10 stable operational slots `PAY-01` … `PAY-10`, active/disabled/archived, limits, health, priority/weight. Test archive preserves historical references. Accept: no hard deletion of referenced adapters.
- [ ] **P1-03 Health and capacity** — Depends: P1-02. Files: registry/health service. Track health, checks, success/failure timestamps, failure rate and pending count. Test unhealthy exclusion and in-flight retention. Accept: configured health policy affects only new routing.
- [ ] **P1-04 Routing engine** — Depends: P1-02/P1-03. Files: `routing.ts`. Implement ROUND_ROBIN, WEIGHTED, PRIORITY, LEAST_LOAD, CAPACITY_BASED and all eligibility filters. Test each strategy, limits, maintenance, disabled adapters and fallback. Accept: client cannot force adapter.
- [ ] **P1-05 Routing decision records** — Depends: P1-04. Files: payment store/service. Persist transaction, adapter, provider, strategy, reason, selected time and config version. Test config changes do not rewrite historical decisions. Accept: complete trace remains queryable.
- [ ] **P1-06 Payment account registry operations** — Depends: P1-02/P0-05. Files: admin server/UI. Add/edit/enable/disable/archive/view/health/priority/limits. Test permission and historical-reference rules. Accept: no secret values exposed.

### P1 — Deposit

- [ ] **P1-07 Deposit creation** — Depends: P1-04/P1-05/P1-01. Files: payment service/routes/player API. Validate method/currency/limits, route, persist transaction, call adapter, return safe instructions. Test amount tampering, duplicate request and unavailable provider. Accept: starts non-completed and never credits from frontend response.
- [ ] **P1-08 Deposit settlement** — Depends: P1-07/P1-10. Files: transaction service/wallet. Verify provider event/status then credit existing ledger once. Test success/failure/expiry/reversal. Accept: wallet credit only after verified settlement.
- [ ] **P1-09 Deposit player UI/history** — Depends: P1-07. Files: player API/types/components. Implement method/amount/review/payment/processing/result and filters. Test loading/error/status rendering. Accept: UI cannot declare success.

### P1 — Withdrawal

- [ ] **P1-10 Withdrawal creation/reservation** — Depends: P0-03/P1-04/P1-05. Files: payment service/wallet/routes. Validate ownership, destination, limits, fees/risk/idempotency; reserve funds before provider request. Test insufficient balance and concurrent duplicate. Accept: available balance is protected atomically.
- [ ] **P1-11 Withdrawal settlement/release** — Depends: P1-10/P1-12. Finalize reservation on verified success; release on verified failure/expiry. Test provider success/failure/retry. Accept: no double debit and no lost funds.
- [ ] **P1-12 Withdrawal player UI/history** — Depends: P1-10. Implement destination masking, fee breakdown, confirmation and status. Test forged fee/destination/status. Accept: server response is authoritative.

### P1 — Webhooks and reconciliation

- [ ] **P1-13 Signed webhook endpoint** — Depends: P1-01/P0-02. Files: `webhooks.ts`, server route. Capture raw body, verify provider signature, schema, provider/reference/state. Test invalid signature, replay and duplicate event. Accept: unverified event has no financial effect.
- [ ] **P1-14 Reconciliation** — Depends: P1-03/P1-13. Files: reconciliation service/admin API/UI. Compare transaction/provider status and classify MATCHED/MISSING/DUPLICATE/MISMATCH/PENDING_TOO_LONG/UNKNOWN. Test each classification. Accept: mismatch creates alert and never silently settles.
- [ ] **P1-15 Safe retry/failover** — Depends: P1-07/P1-13/P1-14. Retry only safe provider operations; fail over only before provider creation; preserve adapter assignment after creation. Test provider errors before/after reference. Accept: no transaction reassignment corruption.

### P1 — Admin/API/observability

- [ ] **P1-16 Payment overview and analytics** — Depends: payment store. Add real aggregate endpoints and date filters. Test aggregates against fixture transactions. Accept: no fabricated provider metrics.
- [ ] **P1-17 Transaction detail/timeline** — Depends: P1-05/P1-13/P0-05. Add owner-safe/admin-authorized trace endpoint and UI. Mask destinations. Test player ownership and admin roles. Accept: WHO/WHAT/WHEN/WHY/provider verification/wallet effect visible to authorised admin.
- [ ] **P1-18 Notifications and support trace** — Depends: settlement. Emit notifications from state transitions only. Test duplicate event creates no duplicate completion notification.
- [ ] **P1-19 Payment rate limits/risk signals** — Depends: existing rate/risk. Add deposit/withdraw/status/webhook/admin operation controls and INFO/MEDIUM/HIGH/CRITICAL signals. Test threshold behavior.

### P2 — Analytics/automation/polish

- [ ] **P2-01 Adapter health automation** — Depends: P1-03. Scheduled checks, stale transaction detection and outage alerts; no fabricated balance effects.
- [ ] **P2-02 Analytics trends** — Depends: P1-16. Adapter/method success/failure/volume/latency/time range reports.
- [ ] **P2-03 Production configuration gate** — Depends: P0-04/P1-01. Real provider adapters remain TEST/SANDBOX/DISABLED until compliance and official credentials are present.
- [ ] **P2-04 UI polish and disclosures** — Depends: player/admin flows. Explicit practice/sandbox labels, status actions and privacy masking.

## Planned data model

`PaymentAdapter`, `PaymentTransaction`, `RoutingDecision`, `ProviderEvent`, `ReconciliationRecord`, `PaymentConfig`, and payment audit references live in an atomic payment store. Existing wallet `Transaction` records remain the financial ledger and receive optional `paymentTransactionId`, fee, currency and reservation metadata. Historical adapter references are retained when an adapter is archived.

## Environment/compliance gate

No real provider credentials or production compliance inputs are available in this repository. The implementation must therefore ship with real-provider slots disabled and sandbox/test adapters clearly labelled. Enabling production UPI/crypto requires official provider contracts, signed webhook configuration, secret-manager integration, KYC/AML/age/jurisdiction policy, licensing review, user disclosures, refund/withdrawal rules and provider approval.

## Verification rule

A task is not complete merely because a route or screen exists. Each task must have a server-side test or a live external request proving the acceptance criterion. The final report will distinguish implemented sandbox capability from real provider configuration and will not claim production readiness without provider verification and compliance evidence.
