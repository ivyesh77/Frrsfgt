# Wager Arena final-product task board

**Audit date:** 2026-10-02 (Asia/Calcutta)  
**Repository:** `ivyesh77/Frrsfgt`  
**Scope:** player app, Super Admin app, isolated Payment Operator app, authoritative payment and wallet rails.

This board is the acceptance audit, not a claim of production readiness. `DONE` means implemented and covered by the current development/self-test boundary. `IN PROGRESS` means code exists but an acceptance or operational proof is still missing. `TODO` means remaining product work. `BLOCKED` means the repository cannot safely complete the item without external infrastructure, provider or compliance inputs.

## Status summary

| Status | Meaning | Current scope |
|---|---|---|
| DONE | Implemented and verified in DEV/TEST | Core player/game/wallet, separate auth namespaces, admin RBAC, operator isolation, sandbox payment lifecycle, account routing/configuration, controlled reconciliation resolution |
| IN PROGRESS | Partial implementation or verification outstanding | Browser E2E, broader operational analytics/alerts, end-to-end payment workflow evidence, production storage hardening |
| TODO | Product/engineering work still required | Durable jobs, richer admin/operator UX, full regression matrix and operational runbooks |
| BLOCKED | Cannot safely enable from this checkout | Real providers, settlement credentials, shared production storage, secret manager, compliance/KYC/AML/jurisdiction approval |

## Acceptance matrix

### P0 security and authority

| ID | Requirement | Status | Evidence / next action |
|---|---|---|---|
| SEC-01 | Player, admin, Super Admin and operator sessions are separate | DONE | Server resolves each namespace independently; player tokens are rejected by admin/operator routes; admin/operator self-tests cover this. |
| SEC-02 | Server owns identity, amount, fee, status, Payment ID, wallet and ledger mutations | DONE | Payment service, transaction state machine, reservation/settlement paths and server-authoritative room engine. Forged-field checks pass. |
| SEC-03 | Payment/account/operator/user IDs cannot be forged across boundaries | DONE | Routing derives adapter; operator reads/actions require assignment; admin route permissions derive from stored role. |
| SEC-04 | Duplicate request, UTR, provider reference and webhook replay prevention | DONE | Idempotency keys, reference uniqueness, provider event uniqueness and repeated settlement tests pass. |
| SEC-05 | CSRF/session-proof boundary for admin mutations, including password change | DONE | Cookie-only mutations return 403; bearer/session-proof mutations work; password-change regression added and passes. |
| SEC-06 | No provider secrets/passwords/private keys in client or normal records | DONE | Secret resolver exposes configured state only; operator and admin responses omit secret material. |
| SEC-07 | Financial actions are audited and reasons are required | IN PROGRESS | Core admin/operator payment actions write audit records. A full route-by-route reason/approval coverage matrix and durable audit sink remain. |
| SEC-08 | Error distinction: only confirmed 401 clears auth | DONE | Player/admin/operator clients preserve 403/429/5xx/network distinctions in current transport code. Browser retest remains outstanding. |

### Player product

| ID | Requirement | Status | Evidence / next action |
|---|---|---|---|
| PLAYER-01 | Login/signup and protected player session | DONE | Password authentication, cookie/bearer preview fallback, signup/login self-tests. |
| PLAYER-02 | Home, mode selection, 1v1 and 4-player matchmaking | DONE | Server queue/room self-test covers duel/squad, duplicate join and cancellation/refund. |
| PLAYER-03 | Lobby, one match timer, authoritative score and timeout/wrong-answer rules | DONE | Gameplay self-test covers server tokens, timer, +1/-1, replay and forfeit behavior. |
| PLAYER-04 | Result, history/detail, profile, stats and achievements | DONE | Existing player screens and server-backed history/stats/achievement flows are covered. |
| PLAYER-05 | Wallet, deposit, withdrawal and notifications | DONE | Existing ledger plus payment wallet UI/API; payment state is not inferred from client state. |
| PLAYER-06 | Payment timer, safe instructions and UTR/proof submission | DONE in TEST | Server-selected account instructions now include configured UPI ID/QR reference metadata and server expiry; proof requires amount/date/reference and does not settle. Real-provider UX remains IN PROGRESS. |
| PLAYER-07 | Transaction lifecycle and settings/support states | DONE / IN PROGRESS | Lifecycle/history/notifications/settings exist; real browser acceptance and retry/offline matrix remain. |

### Super Admin product

| ID | Requirement | Status | Evidence / next action |
|---|---|---|---|
| ADMIN-01 | Separate protected admin login/dashboard | DONE / IN PROGRESS | Separate app/API and dashboard exist; browser login/dashboard validation is still required. |
| ADMIN-02 | Users, rooms/matches, game control and operational views | DONE | RBAC-protected pages and server routes; game cancellation is void/refund, never a forced winner. |
| ADMIN-03 | Payment overview, all transactions and transaction detail | DONE | Payment overview, analytics, transaction list/detail, provider events and audit trace. |
| ADMIN-04 | Payment account add/configure/enable/disable/archive | DONE in TEST | Server-selected Payment IDs, immutable historical assignments, UPI/QR safe config, limits, expiry, capacity and routing controls. Archive preserves history. |
| ADMIN-05 | Routing, limits, health and failover controls | DONE in TEST | Priority/weighted/round-robin/least-load/capacity routing, amount/daily limits, health/capacity filtering, pre-creation failover boundary. |
| ADMIN-06 | Reconciliation list, classification and controlled resolution | DONE in TEST | MATCHED/MISMATCH/UNKNOWN/PENDING_TOO_LONG records plus audited acknowledge/escalate/external-correction disposition; resolution never mutates wallet or transaction state. |
| ADMIN-07 | Operator management, assignment, isolation and workload view | DONE in TEST / IN PROGRESS | SUPER_ADMIN create/disable/assign and scoped operator API are tested; global operator workload is now visible in payment overview. Browser and durable job verification remain. |
| ADMIN-08 | Audit, analytics, alerts/system monitoring | IN PROGRESS | Audit/risk/analytics/system health projections exist; durable alerting, metrics/APM, escalation jobs and operational retention remain. |
| ADMIN-09 | Normal admin cannot use Super Admin-only controls | DONE | Permission matrix and admin self-test cover admin/operator/read-only boundaries and self-protection. |

### Payment Operator product

| ID | Requirement | Status | Evidence / next action |
|---|---|---|---|
| OPS-01 | Separate operator login/session namespace | DONE | Separate app/API, cookie/token namespace and self-test. |
| OPS-02 | Assigned-Payment-ID-only dashboard/accounts/queues | DONE | Every transaction/detail/action/reconciliation query is assignment-scoped; forged cross-account tests return 404. |
| OPS-03 | Deposit/withdrawal queues and detail | DONE | Separate queues, assignment-safe detail, masked player/destination data. |
| OPS-04 | Verify/reject/request-info and provider/reference workflow | DONE in TEST | Workflow state transitions are server checked, reasoned and audited; deposit verification settles through ledger exactly once. |
| OPS-05 | Assigned reconciliation and notifications | DONE in TEST | Scoped reconciliation list, acknowledge/escalate endpoints and assignment alerts. |
| OPS-06 | Operator account security | DONE in TEST | Operator self-password rotation invalidates old sessions and returns a fresh session; no provider credentials are available to operators. |
| OPS-07 | Operator browser E2E, workload SLA and durable sessions | IN PROGRESS | UI builds and HTTP self-test pass; real browser acceptance and shared session persistence remain. |

### Payment integrity and operations

| ID | Requirement | Status | Evidence / next action |
|---|---|---|---|
| PAY-01 | Server-selected Payment ID and immutable historical routing | DONE in TEST | Routing decision is persisted on creation; later account archive does not rewrite historical transaction assignment. |
| PAY-02 | Safe player instructions, expiry and no secrets | DONE in TEST | Adapter returns safe UPI/crypto instructions only; expiry is server-defined; secret values are excluded. |
| PAY-03 | Atomic wallet/ledger behavior | DONE in TEST | Existing ledger is reused; deposits credit only verified completion; withdrawals reserve/release/settle atomically in the development store. |
| PAY-04 | Controlled verification and reconciliation | DONE in TEST | Signed webhook/provider result and operator/admin workflow are state-gated; mismatch is never auto-settled. |
| PAY-05 | Daily limits and eligible routing | DONE in TEST | Global and per-account amount/daily limits are enforced in routing; unhealthy/disabled/full accounts are excluded. |
| PAY-06 | Official UPI/crypto adapters and real settlement | BLOCKED | Only deterministic sandbox adapter is installed. Requires official provider contract/API, webhook contract, credentials, secret manager and compliance inputs. |
| PAY-07 | Shared durable DB/session/job/queue architecture | BLOCKED | Current JSON stores are atomic for local development but are not a multi-instance production transaction boundary. |
| PAY-08 | Reconciliation resolution financial correction workflow | TODO / BLOCKED | Operational disposition exists. Provider-backed reversal/adjustment workflow needs approved policy, evidence model, dual approval and durable audit before implementation. |

## Dependency-ordered next actions

1. **IN PROGRESS:** run real-browser player login/signup and wallet/payment states; run real-browser admin login/dashboard/payment account/reconciliation; run real-browser operator login/queues/security.
2. **IN PROGRESS:** add browser/API regression fixtures for 401 vs 403/429/5xx/network behavior and stale polling.
3. **TODO:** finish admin workload SLA/alerts and operator activity analytics without leaking player IDs or provider secrets.
4. **TODO:** complete route-by-route audit/reason/dual-approval review, including replay and concurrent mutation tests.
5. **BLOCKED:** replace local JSON stores with a shared transactional database, durable session store, job queue and provider reconciliation scheduler.
6. **BLOCKED:** install official provider adapters and secret-manager-backed credentials; keep production activation disabled until provider and compliance sign-off.
7. **BLOCKED:** complete KYC/AML, age/jurisdiction, responsible-use, retention, refund/chargeback, privacy and incident-response controls.

## Verification record

- `cd server && npm run test:all` — passed: player/gameplay, payment, admin and operator suites.
- `cd server && npx tsc --noEmit` — passed.
- `cd admin-web && npm run build` — passed.
- `cd operator-web && npm run build` — passed.
- `npm run build` at repository root — passed.
- Live admin CSRF validation — cookie-only mutation 403; bearer mutation 200 (previously verified).
- Browser E2E — not yet completed; therefore this board deliberately does not mark final product readiness.
