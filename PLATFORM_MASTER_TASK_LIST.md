# Platform master task list

Updated: 2026-10-02 after the complete final-product audit and validation.

> The acceptance matrix for the player, Super Admin, Payment Operator and payment rails is maintained in `FINAL_PRODUCT_TASK_BOARD.md`. This file remains the dependency-ordered implementation plan; do not treat a route or screen as complete without the verification evidence recorded in that board. This is the dependency-ordered incremental implementation plan created after auditing the current repository. Existing working player/game/wallet/payment code is retained. `[x]` means implemented and validated in DEV/TEST; `[~]` means the scoped implementation is partial and the remaining acceptance work is stated inline. A production caveat is recorded where the acceptance boundary still depends on durable infrastructure, live providers or compliance.

## Current execution priority

The next hardening sequence is ordered as requested:

1. **ADMIN SECURITY / RBAC** — active; permission middleware, session separation, rate limits, CSRF session-proof checks and role-boundary tests.
2. **SUPER ADMIN PROTECTION** — next; protect last active SUPER_ADMIN, privileged role changes and account lifecycle controls.
3. **PAYMENT OPERATOR ISOLATION** — implemented in DEV/TEST; durable session/storage hardening remains.
4. **ADMIN AUDIT LOG + SENSITIVE ACTION CONTROLS** — partial; append-only audit exists, broader mandatory reason/approval coverage remains.
5. **PAYMENT RECONCILIATION** — partial; admin and scoped operator queues exist, controlled resolution remains.
6. **GAME/ROOM OPERATIONS HARDENING** — existing server-authoritative controls verified; further operational controls remain.
7. **MONITORING + ALERTS** — partial; health/risk/notification projections exist, durable alert jobs remain.
8. **PRODUCTION DEPLOYMENT HARDENING** — blocked by shared durable infrastructure and compliance gates.
9. **REAL PAYMENT PROVIDER INTEGRATION** — blocked until official provider contracts, credentials and compliance inputs are supplied.

## Audit snapshot

| Surface / subsystem | Status | Evidence / boundary |
|---|---|---|
| Player app | ✅ working / 🧪 test wallet rails | `src/arena`, server-authenticated player API, payment wallet UI; demo wallet is explicitly practice-only. |
| Player auth | ✅ working | `server/src/auth.ts`, durable session journal, cookie + preview bearer fallback, `src/arena/authStore.ts`; login/signup self-tests pass. |
| Admin app | ✅ working / 🧪 preview | `admin-web`, separate Vite port and admin API port; server RBAC on every route. |
| Super admin | ✅ DEV/TEST | `SUPER_ADMIN` role, admin creation, game/payment/routing/limits/flags/maintenance/audit controls plus payment-operator creation/assignment/audit exist; browser acceptance remains pending. |
| Payment operator surface | ✅ DEV/TEST / 🧪 durability | Separate `operator-web`, operator session namespace, assignment model, scoped queues/workflows/notes/reconciliation/notifications and SUPER_ADMIN management are implemented and HTTP self-tested; sessions are in-memory and operator records are JSON-backed. |
| Game engine | ✅ working | Server controls questions, timers, scores, penalties, results and payouts; existing game self-test passes. |
| Matchmaking | ✅ working | Server queues and room membership; 1v1 and four-player tests pass. |
| Wallet / ledger | ✅ working / 🚀 authority boundary | Existing server ledger remains sole balance authority; payment settlement calls ledger paths. |
| Payment adapters/routing | ✅ DEV/TEST / 🧪 sandbox | Adapter registry supports SUPER_ADMIN add and archive/remove of TEST accounts; routing decisions remain permanent and fail-closed UPI/Crypto adapters, signed webhooks and reconciliation remain intact. No live provider is configured. |
| Manual proof/operator workflow | ✅ DEV/TEST | Player proof fields, duplicate UTR/proof rejection, assigned verification/rejection/request-info/withdrawal actions and ledger-connected settlement are implemented; live-provider approval policy remains required. |
| Notifications | ✅ DEV/TEST | Player payment notifications and assignment-scoped operator notifications are implemented; broader admin workload aggregation is still pending. |
| Analytics / audit | ✅ partial | Admin payment analytics/risk, operator audit and reconciliation records exist; operator workload/turnaround aggregation is still pending. |
| Persistence | 🧪 development | Atomic JSON stores are used by the repository; production requires a transactional DB/shared session and job architecture. |

## Execution order and acceptance criteria

Every task includes dependency, files/modules, implementation, test, and acceptance criteria. Execute top-to-bottom; do not enable a later task if its dependency remains incomplete.

### P0 SECURITY / DATA ISOLATION

- [x] **P0-01** (deps: none) Preserve player/admin namespace separation. Files: `server/src/auth.ts`, `server/src/admin/permissions.ts`, `server/src/admin/auth.ts`, `src/arena/authStore.ts`, `admin-web/src/AuthContext.tsx`. Test: player token against admin endpoints, admin token against player endpoints, stale/invalid tokens. Acceptance: only server-resolved identity is used; player tokens never authenticate as admins.
- [x] **P0-02** (deps: P0-01) Preserve server-authoritative game/wallet/payment mutation boundaries. Files: `server/src/index.ts`, `server/src/rooms.ts`, `server/src/wallet.ts`, `server/src/payments/*`. Test: forged userId/amount/fee/status/score/adapter and duplicate/concurrent requests. Acceptance: all financial/game outcomes are server-derived.
- [x] **P0-03** (deps: P0-01) Keep secrets out of clients, logs and ordinary records. Files: `server/src/payments/secrets.ts`, adapter registry, operator auth. Test: inspect public responses, browser state, audit responses and logs. Acceptance: only secret references/fingerprints are exposed; operator credentials are platform credentials, never provider credentials.
- [x] **P0-04** (deps: P0-01) Enforce operator account isolation. Files: new `server/src/operator/*`, `server/src/payments/operators.ts`, operator API. Test: PAY-07 operator requests PAY-08 and another operator's records. Acceptance: server returns 403/404 and reveals no unassigned data.

### P1 PLAYER

- [x] **P1-01** (deps: P0-01) Keep player home/profile/stats/history/achievements/wallet/notifications/support flows server-backed. Files: `src/arena/*`, `server/src/index.ts`. Test: existing full self-test and auth/browser transport checks. Acceptance: no client identity cache is authoritative.
- [x] **P1-02** (deps: P1-01, P1-15) Add player payment-proof submission UI/API for UTR/reference/date and safe optional evidence metadata. Files: `server/src/payments/types.ts`, `server/src/payments/workflow.ts`, `server/src/index.ts`, `src/arena/api.ts`, `src/arena/components/WalletScreen.tsx`. Test: owner route, amount/date/reference validation, duplicate same-transaction proof, duplicate cross-transaction UTR, and proof-before-operator-settlement flow. Acceptance: proof is evidence only; the proof endpoint leaves wallet balance unchanged and only a controlled server workflow settles.
- [x] **P1-03** (deps: P1-01) Keep player loading, pending, error, retry, offline and notification states honest. Files: player components/API. Test: 401/403/429/5xx/network paths. Acceptance: no fake success and no false logout on inconclusive errors.

### P1 GAME

- [x] **P1-10** (deps: P0-02) Preserve one authoritative core game for 1v1 and 4-player formats. Files: `server/src/gameKinds/*`, `server/src/rooms.ts`, player game components. Test: score, timer, wrong penalty, tie, replay and post-end attacks. Acceptance: client sends only opaque question/option tokens.
- [x] **P1-11** (deps: P1-10) Preserve real-player lobby/ready/countdown/profile-safe data. Files: `server/src/rooms.ts`, `src/arena/components/*`. Test: no fake players and no private IDs. Acceptance: only public display data is exposed.

### P1 MATCHMAKING

- [x] **P1-20** (deps: P1-10) Preserve server matchmaking queues, room assignment, reconnect and cancellation/refund. Files: `server/src/rooms.ts`, `server/src/index.ts`, socket client. Test: concurrent 1v1/four-player joins, disconnect, rematch and ready timeout. Acceptance: no client room/seat assignment.

### P1 ADMIN

- [x] **P1-30** (deps: P0-01) Preserve operational admin dashboard/users/rooms/matches/wallet/payment/support/risk/audit views. Files: `server/src/admin/server.ts`, `admin-web/src/pages/*`. Test: admin self-test, CSRF cookie-only mutation rejection and all route smoke checks. Acceptance: every mutation has server permission and audit reason; browser-origin mutation proof is required when an admin cookie is present.
- [x] **P1-31** (deps: P1-30) Preserve admin payment adapter/config/transaction/reconciliation UI. Files: payment admin pages and routes. Test: read/write permissions, historical adapter detail, stale detail/polling cases. Acceptance: no secret or internal ledger IDs in player responses.
- [ ] **P1-32** (deps: P1-30, P1-50) Add operator workload visibility to admin payment overview and alerts. Files: admin payment overview, payment analytics, notifications. Test: assigned backlog and health alert counts. Acceptance: admin sees global operations, not operator secrets. **Not implemented; operator dashboard currently exists separately.**

### P1 SUPER ADMIN

- [x] **P1-40** (deps: P1-30) Preserve SUPER_ADMIN admin management, game config, flags, maintenance, payment config, routing, limits, audit controls. Files: `server/src/admin/permissions.ts`, `server/src/admin/auth.ts`, `server/src/admin/server.ts`, admin pages. Test: role boundary, duplicate admin rejection, invalid-role rejection, self-deactivation/self-demotion protection and audited mutations. Acceptance: normal admin/operator cannot access SUPER_ADMIN mutations; an active SUPER_ADMIN cannot lock out or demote itself.
- [x] **P1-41** (deps: P1-40, P1-50) Add SUPER_ADMIN payment operator account/assignment management. Files: `server/src/admin/server.ts`, `server/src/admin/types.ts`, `admin-web/src/pages/PaymentOperators.tsx`, `admin-web/src/App.tsx`. Test: SUPER_ADMIN create/assign/disable, normal `ADMIN` 403, invalid assignment rejection and audit-backed management. Acceptance: only SUPER_ADMIN with `PAYMENT_OPERATOR_ADMIN` can create operators or change assignments.
- [x] **P1-42** (deps: P1-40, P1-60) Add and remove payment accounts from the admin payment-account registry. Files: `server/src/payments/types.ts`, `server/src/payments/store.ts`, `server/src/payments/registry.ts`, `server/src/admin/server.ts`, `admin-web/src/pages/PaymentAdapters.tsx`. Test: add creates a disabled TEST account, archive/remove disables new routing, existing history remains, and dynamic account assignment can be added/removed from an operator. Acceptance: account removal is an audited archive rather than destructive deletion; no live provider is enabled by this action.

### P1 PAYMENT OPERATORS

- [x] **P1-50** (deps: P0-04, P1-40) Add a separate operator auth/store/session namespace and `PAYMENT_OPERATOR` account model. Files: `server/src/operator/auth.ts`, `server/src/operator/store.ts`, `server/src/operator/server.ts`, `server/src/operator/types.ts`. Test: separate login namespace, logout/session invalidation, disabled operator, player/admin token isolation and secret-response inspection. Acceptance: operator session cannot authenticate as player/admin. **DEV/TEST only: sessions are in-memory and records are JSON-backed; password rotation and shared durable sessions remain open.**
- [x] **P1-51** (deps: P1-50) Add configurable separate operator port and operator Vite app. Files: `OPERATOR_PORT`, `operator-web/vite.config.ts`, `operator-web/src/*`, `server/src/index.ts`. Test: independent app boot/build and same-origin proxy health. Acceptance: player/admin/operator are separate surfaces and ports. **Validated on 5190/8789 in DEV.**
- [x] **P1-52** (deps: P1-41, P1-50) Add assignment-scoped operator APIs and dashboard. Files: `server/src/operator/server.ts`, `operator-web/src/*`. Test: PAY-02 operator cannot read/mutate PAY-01, forged IDs return 404, assigned queues/accounts only. Acceptance: dashboard, assigned accounts, deposits, withdrawals, transactions and reconciliation contain assigned data only.
- [x] **P1-53** (deps: P1-52, P1-15) Add operator workflow actions and immutable operator audit trail. Files: `server/src/payments/workflow.ts`, `server/src/operator/server.ts`, `server/src/operator/store.ts`, `operator-web/src/*`. Test: VERIFY/REJECT/REQUEST_INFO/PROCESS/CONFIRM authorization, replay/concurrency-adjacent guards, notes, scoped notifications and ledger-connected settlement. Acceptance: operator cannot directly mutate wallet/status outside policy. **Audit is append-only through the API; JSON-store immutability/durability is not production-verified.**

### P1 PAYMENTS

- [x] **P1-60** (deps: P0-02) Preserve payment adapter abstraction, registry, limits, environment gate and fail-closed official adapters. Files: `server/src/payments/adapters.ts`, `registry.ts`, `secrets.ts`. Test: TEST/SANDBOX behavior and PRODUCTION fail-closed. Acceptance: no bank automation and no provider secrets in clients.
- [x] **P1-61** (deps: P1-60) Preserve deposit creation → route → instructions → verified event/status → ledger credit. Files: `service.ts`, `transaction.ts`, `webhooks.ts`, player API/UI. Test: pending/no credit, valid settlement, duplicate event, invalid signature. Acceptance: exactly one ledger credit.
- [x] **P1-62** (deps: P1-60) Preserve withdrawal reserve → provider processing → confirmed/failure/reversal. Files: wallet/payment transaction modules. Test: fees, reservation, completion, release, reversal, idempotency. Acceptance: no funds disappear or double-debit.
- [x] **P1-63** (deps: P1-61, P1-15, P1-50) Add manual workflow states/proof records without replacing provider settlement states. Files: `server/src/payments/types.ts`, `server/src/payments/store.ts`, `server/src/payments/workflow.ts`, `server/src/payments/service.ts`. Test: pending/no-credit, duplicate same-transaction proof, duplicate cross-transaction UTR, unique operator verification and signed provider events. Acceptance: proof is not authority; only server-approved verification/official event can settle. **Live provider/compliance approval remains disabled.**

### P1 ROUTING

- [x] **P1-70** (deps: P1-60) Preserve ROUND_ROBIN/WEIGHTED/PRIORITY/LEAST_LOAD/CAPACITY routing and permanent routing decisions. Files: `server/src/payments/routing.ts`, store/admin config. Test: eligibility filters, config version and historical immutability. Acceptance: client adapterId is ignored.
- [x] **P1-71** (deps: P1-70, P1-41) Add operator assignment-aware operational views without changing transaction routing authority. Files: `server/src/operator/server.ts`, `server/src/admin/server.ts`, `server/src/payments/routing.ts`. Test: assignment-scoped accounts/transactions and historical transaction attachment; operator ID/account filters cannot widen scope. Acceptance: routing and operator authorization stay separate.

### P1 RECONCILIATION

- [x] **P1-80** (deps: P1-61, P1-62) Preserve reconciliation records and PENDING_TOO_LONG classification. Files: `server/src/payments/reconciliation.ts`, admin routes/UI. Test: provider/internal/ledger mismatch and no auto-settlement. Acceptance: mismatches alert and require controlled resolution.
- [~] **P1-81** (deps: P1-63, P1-80, P1-53) Add assigned-operator reconciliation queue and controlled resolution. Files: `server/src/operator/server.ts`, `operator-web/src/*`, `server/src/payments/reconciliation.ts`. Test: scoped reconciliation reads and cross-account isolation. Acceptance: no operator can reconcile another account. **Scoped queue is implemented; operator-side controlled resolution is not yet exposed.**

### P1 WALLET

- [x] **P1-90** (deps: P1-61, P1-62) Keep existing wallet ledger sole financial authority. Files: `server/src/wallet.ts`, `server/src/store.ts`, payment transaction service. Test: ledger invariants and concurrent withdrawal. Acceptance: all balance changes have one auditable ledger entry.
- [x] **P1-91** (deps: P1-90, P1-63) Connect manual verification/reversal to existing ledger paths, never direct balance writes. Files: `server/src/payments/workflow.ts`, `server/src/payments/transaction.ts`, operator API. Test: operator verification credits the existing ledger exactly once and updates adapter pending metrics; terminal replay is rejected. Acceptance: exactly-once credit/release. **Provider reversal remains an official provider/admin path, not an operator shortcut.**

### P1 NOTIFICATIONS

- [x] **P1-100** (deps: P1-61, P1-62) Preserve player payment notifications/read state. Files: notifications, player API/UI. Test: transition notification and duplicate delivery. Acceptance: status is server-derived.
- [x] **P1-101** (deps: P1-50, P1-53, P1-80) Add scoped operator notifications and admin/super-admin payment alerts. Files: `server/src/operator/server.ts`, `operator-web/src/*`, existing payment/admin alert stores. Test: assignment-scoped operator notifications and backlog/failure alert projection. Acceptance: no cross-account operator alerts. **Global admin workload aggregation remains P1-32.**

### P2 ANALYTICS

- [x] **P2-01** (deps: existing payment records) Preserve admin payment analytics/risk endpoints and adapter volume/processing metrics. Files: admin server/payment overview. Test: date/adapter filters and empty states. Acceptance: real backend data only.
- [ ] **P2-02** (deps: P1-52, P1-53, P1-81) Add operator workload/turnaround/rejection metrics and admin aggregation. Test: assigned-account scope and audit-derived turnaround. Acceptance: operator cannot infer unrelated account data.

### P2 MONITORING

- [x] **P2-10** (deps: P1-60, P1-80) Preserve adapter health, webhook failure and reconciliation monitoring. Test: timeout/outage/delayed/out-of-order events. Acceptance: unhealthy accounts leave new routing while existing transactions remain attached.
- [ ] **P2-11** (deps: P2-10) Add durable retry/job/alert processing for provider status and operator queues. Test: restart/retry/dead-letter behavior. Acceptance: no duplicate financial mutation and no silent lost work.

### P2 POLISH

- [ ] **P2-20** (deps: P1-51, P1-52) Complete operator UI loading/empty/error/offline/success states and coherent operational design.
- [ ] **P2-21** (deps: all) Add browser acceptance tests for all four surfaces and final environment matrix.
- [ ] **P2-22** (deps: all) Production database/shared-session/compliance/provider gate. Acceptance: live capability remains disabled until verified.

## Validation run

| Area | Result | Evidence |
|---|---|---|
| Server TypeScript | PASS | `npx tsc --noEmit` in `server` |
| Player build | PASS | `npx tsc -b --force && npm run build` |
| Admin build | PASS | `npm run build` in `admin-web` |
| Operator build | PASS | `npm run build` in `operator-web` |
| Player/game self-test | PASS in clean isolated data | `PORT=8801 ADMIN_PORT=8802 OPERATOR_PORT=8803 npm run test --prefix server`; one earlier run was contaminated by intentionally enabled preview adapter state and was rerun clean |
| Payment self-test | PASS | `npm run test:payments --prefix server` |
| Admin self-test | PASS | `npm run test:admin --prefix server` including cookie-only mutation rejection and dynamic account add/archive |
| Admin security/RBAC | PASS | Separate auth namespace, server permission checks, rate limits, cookie-only mutation CSRF proof rejection, player-token rejection and role boundary assertions |
| Operator HTTP self-test | PASS | `npm run test:operator --prefix server` |
| Live security retest | PASS | `node security-retest.mjs http://127.0.0.1:8787` — 15 exploit attempts blocked |
| Live operator isolation | PASS | PAY-01/PAY-02 cross-account read/action, disabled session, normal-admin permission boundary |
| Payment-account add/remove | PASS | Live SUPER_ADMIN add created PAY-11 disabled TEST account; archive removed it from new routing; dynamic operator assignment was added and then removed |
| Live proxy/app boot | PASS | HTTP 200 for player/admin/operator apps and health through operator/admin/player proxies |
| Real-browser acceptance | INCOMPLETE | No browser automation tool is available in this run; HTTP/build checks are not a substitute for the requested real-browser login/dashboard checks |

## Release gates

- **DEV/TEST — COMPLETED:** player/admin/payment rails and the separate operator implementation compile, boot and pass the available self/security tests. Live capability remains sandbox/test only.
- **STAGING READY — INCOMPLETE/BLOCKED:** browser acceptance, operator reconciliation resolution, admin workload aggregation and durable multi-instance behavior remain open.
- **PRODUCTION READY — BLOCKED:** verified live providers, jurisdiction/KYC/AML/age/responsible-use/compliance controls, transactional shared persistence, durable shared sessions, job/retry/observability/retention controls and complete E2E gates are not established; all real-money adapters remain TEST/SANDBOX/DISABLED.
