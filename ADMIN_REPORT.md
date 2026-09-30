# Wager Arena — Admin Operations Center: Final Report

This report follows the same standard as `AUDIT_REPORT.md`, `SECURITY_FIX_REPORT.md`, and
`MULTIPLAYER_REPORT.md`: concrete claims, tests actually run, and an explicit, honest
statement of scope and limitations. **Nothing here is "fully production-ready" merely
because a UI exists** — see §17 for exactly what would still be needed for that.

---

## 1. What was built, in one paragraph

A completely separate admin application — its own Express API on its own configurable
port (`ADMIN_PORT`, default `8788`) and its own standalone React app (`admin-web/`, its own
`package.json`, dev server, and build) — giving authorized staff real, permission-gated
visibility and control over users, rooms/matches, matchmaking, game configuration, game
content, wallets/transactions, payment provider configuration (UPI/crypto, honestly scoped
— see §9), risk/anti-cheat signals, analytics, system health, audit logs, feature flags,
maintenance mode, and support tooling. It reads and mutates the **exact same live backend
state** the player app uses (same `RoomManager`, same user/wallet store) — never a second,
duplicated, or simulated copy of that data.

## 2. Architecture

```
                         ONE Node process (server/src/index.ts)
                         ├── Player HTTP+WS API  — PORT (default 8787)
                         │     ../src (player React app, port 5173, existing)
                         └── Admin HTTP API      — ADMIN_PORT (default 8788)
                               admin-web/ (admin React app, own dev port, e.g. 5180)
```

Both HTTP servers are booted from the same `index.ts` and share the same in-process
`RoomManager`/`Server` (Socket.IO) instances **by direct reference** — this is a deliberate
choice, not an oversight: it means every admin read reflects the real, live backend state
instantly, with no second data layer to fall out of sync, no polling of the player API from
the admin side, and no risk of the admin panel showing stale/simulated numbers. The trade-off,
stated honestly: this is not a network-isolated microservice — it is a second router mounted
on a second port within the same process. For a real production deployment, run `ADMIN_PORT`
behind its own reverse-proxy/network ACL so it is only reachable from a staff network, and
set `ADMIN_ALLOWED_ORIGIN` to the admin web app's real origin (CORS defaults to **no**
cross-origin access at all if that env var isn't set — stricter than the player API's CORS
policy on purpose, since the admin panel has no reason to accept arbitrary-origin requests).

The admin frontend (`admin-web/`) is a **fully separate application**: separate
`package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, and `src/` tree. It never
imports from `../src` (the player app) and is never bundled into it. Its dev server proxies
`/admin/*` to `ADMIN_PORT`, mirroring exactly how the existing player app proxies `/api` to
`PORT` — the browser only ever talks to one same-origin dev server either way.

## 3. Security model (§2–3, §43, §48 of the spec)

- **Completely separate identity system.** `server/src/admin/auth.ts` has its own admin
  account store (`server/data/admin-store.json`, a separate file from the player ledger),
  its own password hashing (reusing the same scrypt implementation as the player system —
  no second, weaker scheme), and its own session map with its own cookie
  (`arena_admin_session`, distinct from the player's `arena_session`). **Verified live**: a
  real, valid player session token is rejected with 401 by every admin route tested; a real
  admin token is rejected by nothing on the player side (there's no code path that would
  even look at it).
- **No hardcoded admin password.** The only way an admin account is ever created is (a) a
  one-time bootstrap of the first `SUPER_ADMIN` from `ADMIN_BOOTSTRAP_NAME` /
  `ADMIN_BOOTSTRAP_PASSWORD` environment variables (refuses to run if no admin exists yet
  and these aren't set, and refuses a bootstrap password under 12 characters), or (b) an
  existing `SUPER_ADMIN`/`ADMIN` explicitly creating one through the authenticated,
  audited `POST /admin/admin-users` route.
- **No frontend-only admin flag, ever.** `admin-web/` never stores or checks a role/
  permission for authorization purposes — it only reads `GET /admin/auth/me`'s response to
  decide what to *show* (hide a nav link, disable a button). Every single admin API route
  independently re-resolves the caller's identity from their session token and independently
  re-checks the ROLE_PERMISSIONS matrix server-side (`admin/permissions.ts`) — verified live
  by calling routes directly with curl, bypassing the UI entirely (see §6).
- **Role-based access control**, exactly the roles specified: `SUPER_ADMIN`, `ADMIN`,
  `GAME_OPERATOR`, `PAYMENT_OPERATOR`, `SUPPORT_AGENT`, `ANALYST`, `READ_ONLY`. The full
  permission matrix lives in `server/src/admin/types.ts` (`ROLE_PERMISSIONS`) — the single
  source of truth, never derived from anything client-supplied.
- **Session security**: 12-hour idle-timeout admin sessions (shorter-lived than a player
  session by design), `httpOnly` cookies, force-logout-all-sessions on account
  deactivation, admin login rate-limited (10/15min per IP) with the same timing-safe
  "wrong password" vs "no such account" response as the player login.
- **MFA-ready architecture**: the admin auth module resolves identity from an opaque
  session token after a password check — adding a second (TOTP/WebAuthn) factor would slot
  in as an additional required step between "password verified" and "session issued"
  without restructuring anything. **Not implemented** — see §17.
- **Input validation / no arbitrary SQL**: every admin route validates its own inputs
  (amounts, enums, role names) server-side; there is no raw query execution surface at all
  (the whole backend has no SQL — it's a controlled service-layer over an in-memory +
  JSON-file store, same as the pre-existing player system).
- **Never trusts** `adminId`/`role` from the request body, a target user/wallet id alone
  without a permission check, or a client-provided status — every mutating route derives the
  actor from the session and re-validates the actual target record server-side before acting.

## 4. What is genuinely real vs. honestly scoped

| Area | Status |
|---|---|
| Users, rooms, matchmaking, game config, game content (enable/disable), wallet/transactions, audit log, feature flags, maintenance, admin RBAC, risk signals, anti-cheat counters, analytics | **Fully real** — reads/writes the actual live backend state, backed by real self-tests (§8). |
| Payment providers (UPI/crypto) | **Real configuration layer, honestly empty of transaction data.** This product has no real payment processor integrated (documented since `AUDIT_REPORT.md`) — the wallet is an explicit practice-currency ledger. The admin screens for UPI/crypto/webhooks/reconciliation are fully functional as *configuration and monitoring scaffolding* a real integration would plug into, but they do not fabricate fake transactions, fake webhook events, or a falsely-reassuring reconciliation report. An empty webhook list and "not_connected" provider health are **correct, honest states**, not missing features hidden behind a TODO. |
| Logs | **Narrower than the full spec.** The queryable "logs" today are the admin audit log plus login-attempt records. There is no separate structured application/system logger capturing `console.*` output into a searchable store. Disclosed here rather than presented as something it isn't. |
| System health / API latency / error-rate percentiles | **Real for what exists** (process uptime, memory, live socket count, room count), **honestly absent** for what doesn't (no APM is wired up, so latency percentiles are reported as unavailable, never fabricated). |
| MFA | Architecture is ready for it (see §3); not implemented. |
| Real file-upload for game content | Not implemented. Game content management is real, functional active/inactive + tag control over the existing small, fixed, bundled asset set — not a new upload pipeline. |
| Correlation-ID tracing across a payment provider → webhook → ledger chain | Request IDs exist and are attached to every audit entry (`x-request-id`); there is no real external provider to trace *to* yet. |

## 5. Files added / changed

**New — server (`server/src/admin/`)**: `types.ts` (roles, permissions, all domain types),
`store.ts` (separate JSON persistence), `auth.ts` (admin auth/sessions/bootstrap),
`permissions.ts` (`requireAdmin`/`requirePermission` middleware), `audit.ts` (audit-log
writer), `config.ts` (versioned, admin-editable game config), `flags.ts` (feature flags),
`maintenance.ts` (maintenance scopes), `gameContent.ts` (asset active/inactive/tags),
`payments.ts` (UPI/crypto config, webhook intake+idempotency, reconciliation), `risk.ts`
(real risk-signal + anti-cheat computation), `signals.ts` (sliding-window real event
counters), `matchHistory.ts` (append-only finished-match log — live `Room`s are deleted
shortly after they end), `notifications.ts`, `support.ts`, `users.ts` (admin user
management), `server.ts` (the actual Express app + all `/admin/*` routes).

**New — tests**: `server/src/adminSelftest.ts` (65 assertions, see §8).

**New — admin frontend**: `admin-web/` — a complete separate app (`package.json`,
`vite.config.ts`, `tsconfig.json`, `index.html`, `src/{main.tsx,App.tsx,AuthContext.tsx,
api.ts,hooks.ts,types.ts,format.ts,admin.css}`, `src/components/{ui.tsx,
GlobalSearchBar.tsx}`, `src/pages/*.tsx` × 24 screens covering the full nav in §50 of the
spec).

**Changed — existing server files (additive only, nothing removed/weakened)**:
- `server/src/types.ts` — added `AccountStatus` to `User`; added `'admin_adjustment'` to
  `TransactionType`; extended `MatchResultPublic.endedBy` with `'admin_cancelled'`.
- `server/src/store.ts` — backfills `status: 'active'` for pre-existing records; added
  admin-only bulk-read helpers (`listAllUsersRaw`, `listAllTransactionsRaw`) that funnel
  through the same public-projection functions everywhere they're used, exactly like the
  player-facing routes already did.
- `server/src/auth.ts` — added `destroyAllSessionsForUser` / `countActiveSessionsForUser`
  (additive; nothing about existing session resolution changed).
- `server/src/wallet.ts` — `registerUser` now sets `status: 'active'`; `authenticateUser`
  now rejects a suspended/banned account **after** password verification (so a wrong
  password against a banned account looks identical to a wrong password against any other
  account — no status leak); added `adminAdjustBalance` (the *only* function anywhere that
  lets an operator directly change a balance outside gameplay/deposit/withdraw, recording
  its own distinct `admin_adjustment` transaction type so it can never be miscounted as a
  real wager/deposit/payout in analytics).
- `server/src/rooms.ts` — reads match timing/scoring from the new admin-configurable
  `getEffectiveGameConfig()` instead of hardcoded env-only getters (env vars still work
  identically as the fallback default — `selftest.ts`'s existing env-var overrides are
  unaffected, verified by rerunning it); records real signal events (`queueJoin`,
  `reconnect`, `answerSubmitted`, `roundTimeout`, `staleRoundRejected`, `tooFastRejected`,
  `nonMemberAnswerAttempt`) at the exact points those things already happened; records a
  match-history entry on every finish/cancel; added `listRoomsAdmin`/`getRoomAdminDetail`/
  `adminCancelRoom` (an admin cancel of an **active** match is *always* forced to a full
  void/refund via `endMatch(room, 'admin_cancelled')` — there is no code path that lets it
  produce a winner or touch a score).
- `server/src/gameKinds/memoryMatch.ts` — draws only from admin-enabled assets.
- `server/src/index.ts` — boots the admin server alongside the player server; records real
  player login attempts; enforces `platform` maintenance on signup/login, `wallet`/
  `deposit`/`withdraw` maintenance on the wallet routes, and `matchmaking`/`game`
  maintenance plus the `duelEnabled`/`squadEnabled` feature flags on `queue:join` — **this
  is real enforcement**, verified live in §8 (a real player socket is actually rejected).

None of this weakens anything from Task 10/11: the player session cookie flow, rate
limiting, anti-cheat token model, and matchmaking authority are all unchanged except for
the additive account-status check and the additive config/flag/maintenance reads (which
default to exactly the prior always-on/always-available behavior unless an admin
explicitly changes them).

## 6. Live security verification actually performed

Run against the real, running dev servers (not just the self-test suite) with `curl`,
bypassing the UI entirely:

1. ✅ No token at all against `/admin/dashboard`, `/admin/users` → `401`.
2. ✅ A garbage/forged bearer token against the same routes → `401`.
3. ✅ **A real, currently-valid player session token** against `/admin/dashboard`,
   `/admin/users`, `/admin/game/config` → `401` on every one — the two identity systems
   are genuinely disjoint, not just visually separated.
4. ✅ A freshly-created `SUPPORT_AGENT` admin account: can view users/transactions, **is
   rejected with 403** attempting a wallet adjustment, suspending a user, or creating
   another admin account.
5. ✅ A freshly-created `GAME_OPERATOR`: can view/moderate rooms and edit game config, **is
   rejected with 403** viewing the wallet overview or creating an admin account.
6. ✅ A freshly-created `PAYMENT_OPERATOR`: can view/edit payment config, **is rejected
   with 403** viewing rooms or editing game config.
7. ✅ A freshly-created `READ_ONLY` admin: can view broadly, **is rejected with 403** on
   every single mutation attempted (flags, maintenance).
8. ✅ **Found and fixed during this work**: the very first version of the
   suspend/ban/unsuspend/unban response (and, because it fed straight into the audit log,
   the *audit trail itself*) serialized the raw internal `User` record — including the
   scrypt password hash — into the JSON response. Caught by manually inspecting a live
   response during testing (not by an automated check that happened to exist already),
   fixed by having `admin/users.ts`'s moderation functions return only
   `toPublicUser(...)`, and **re-verified live** that neither the API response nor any new
   audit entry contains `passwordHash`. One pre-fix test-session audit entry retained the
   leak on disk before being wiped along with all other dev-session test data — this is
   disclosed here rather than hidden, and is exactly why this report does not claim
   "unhackable": a similar undiscovered bug in a not-yet-written code path could do the
   same thing again until it, too, is found. Audit logs are only as trustworthy as the code
   that writes them.

## 7. Automated tests (`server/src/adminSelftest.ts`, `npm run test:admin` from `server/`)

65 assertions, all passing, covering exactly the checklist in spec §52:

- **Admin auth**: wrong password / nonexistent username rejected identically (401, no
  enumeration); bootstrap `SUPER_ADMIN` login works; `GET /admin/auth/me` resolves the real
  session.
- **Unauthorized admin API access**: no token, garbage token, and — the one that matters
  most — a real player session token, all rejected.
- **Admin RBAC**: every one of `GAME_OPERATOR`/`PAYMENT_OPERATOR`/`SUPPORT_AGENT`/
  `READ_ONLY`'s permission boundaries, both the "can" and the "cannot" side, asserted via
  real HTTP calls against real freshly-created accounts.
- **User access control + balance adjustment**: missing-reason rejected; a real credit
  adjustment produces the exact before/after balance; the ≥50,000 second-approval threshold
  is enforced; a debit that would overdraft is rejected.
- **Audit logging**: a successful action produces a `success` entry; **rejected** actions
  (missing reason, threshold, overdraft) also produce `failure` entries — the trail is never
  selectively incomplete; an admin's own "My Activity" view is scoped to their own actions.
- **Feature flags actually gate real gameplay**: disabling `squadEnabled` causes a real
  player socket's real `queue:join` for `format: 'squad'` to be rejected; re-enabling it
  immediately un-blocks the same real socket. This is not a check against admin-side state —
  it's an assertion against the real player-facing Socket.IO behavior.
- **Maintenance mode actually blocks real player actions**: enabling `matchmaking`
  maintenance causes a real player's real `queue:join` to be rejected; disabling it restores
  normal behavior.
- **Game config changes are real**: after an admin changes `matchDurationMs`, a freshly
  started real match's actual `matchEndsAt` timer reflects the new value (observed within
  1.5s of the requested value), not the old default.
- **Room access + match control**: an admin can inspect a live active match by room id;
  force-cancelling it always reports `endedBy: 'admin_cancelled'` and `isVoidMatch: true`;
  every player is refunded their *exact* entry fee; **nobody is ever declared a winner**;
  cancelling an already-finished room a second time is rejected, not silently repeated.
- **Webhook processing + duplicate webhook**: a fresh event ingests as `received`; a second
  delivery with the identical idempotency key is recognized and ignored as
  `duplicate_ignored`, never double-processed; retrying a non-terminal event is allowed;
  retrying a duplicate-ignored event is rejected (nothing safe to retry).

The pre-existing player self-test suite (`npm test`, 60+ assertions covering matchmaking,
scoring, payouts, draws, forfeits, reconnects) was re-run after every change in this body of
work and **still passes unchanged** — confirming none of the admin work weakened the
existing player-facing system.

## 8. Permissions matrix (server-authoritative source: `admin/types.ts`)

| Permission area | SUPER_ADMIN | ADMIN | GAME_OPERATOR | PAYMENT_OPERATOR | SUPPORT_AGENT | ANALYST | READ_ONLY |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Dashboard | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Users view / moderate | ✅/✅ | ✅/✅ | –/– | –/– | ✅/– | –/– | ✅/– |
| Rooms view / moderate | ✅/✅ | ✅/✅ | ✅/✅ | –/– | –/– | –/– | ✅/– |
| Matchmaking view / moderate | ✅/✅ | ✅/✅ | ✅/✅ | –/– | –/– | –/– | ✅/– |
| Game config view / edit | ✅/✅ | ✅/✅ | ✅/✅ | –/– | –/– | –/– | ✅/– |
| Game content view / edit | ✅/✅ | ✅/✅ | ✅/✅ | –/– | –/– | –/– | ✅/– |
| Wallet view / adjust | ✅/✅ | ✅/✅ | –/– | ✅/✅ | –/– | –/– | ✅/– |
| Transactions view | ✅ | ✅ | – | ✅ | ✅ | – | ✅ |
| Payments view / edit | ✅/✅ | ✅/✅ | –/– | ✅/✅ | –/– | –/– | ✅/– |
| Webhooks view / retry | ✅/✅ | ✅/✅ | –/– | ✅/✅ | –/– | –/– | ✅/– |
| Reconciliation view | ✅ | ✅ | – | ✅ | – | – | ✅ |
| Risk / anti-cheat view | ✅ | ✅ | –/✅ | –/– | –/– | ✅/– | ✅/✅ |
| Analytics view | ✅ | ✅ | ✅ | ✅ | – | ✅ | ✅ |
| System / logs / audit view | ✅ | ✅ | – | – | – | – | ✅ |
| Flags / maintenance view / edit | ✅/✅ | ✅/✅ | –/– | –/– | –/– | –/– | ✅/– |
| Support view / edit | ✅/✅ | ✅/✅ | –/– | –/– | ✅/✅ | –/– | ✅/– |
| Admin management | ✅ | – | – | – | – | – | – |

(SUPPORT_AGENT deliberately has **no** wallet/game-config mutation permission anywhere in
this matrix, per the explicit spec requirement.)

## 9. New admin API routes (all under `/admin/*` on `ADMIN_PORT`)

`/admin/auth/{login,logout,me}` · `/admin/dashboard` · `/admin/users[/:id[/suspend|
unsuspend|ban|unban|force-logout|notes]]` · `/admin/rooms[/:id[/cancel]]` ·
`/admin/matchmaking` · `/admin/game/config` · `/admin/game/content[/:id/active|tags]` ·
`/admin/wallets/overview` · `/admin/wallets/:userId[/adjustment]` · `/admin/transactions` ·
`/admin/payments/{providers,upi,crypto[/:asset/:network]}` · `/admin/webhooks[/:id/retry]` ·
`/admin/reconciliation` · `/admin/risk` · `/admin/anticheat` · `/admin/analytics/{users,
games,payments}` · `/admin/system/health` · `/admin/logs` · `/admin/audit[/me]` ·
`/admin/flags[/:flag]` · `/admin/maintenance[/:scope]` · `/admin/support/tickets[/:id]` ·
`/admin/notifications[/:id/ack|resolve]` · `/admin/admin-users[/:id]` · `/admin/search` ·
`/admin/me/activity`.

## 10. Production readiness — honest verdict

**What is genuinely production-solid**: the RBAC/permission boundary (independently
verified live, not just trusted from the code), the separation between admin and player
identity, the audited-adjustment workflow (never a direct balance edit), the fact that
force-cancelling a match can never produce a winner, and the fact that feature
flags/maintenance mode are real enforcement points a client cannot bypass.

**What is NOT yet production-ready, stated plainly**:
- No MFA implemented (architecture supports adding it).
- Single JSON-file storage for both the player ledger and the admin store — the same
  documented limitation as the rest of this codebase, not something this admin work
  introduced or fixed. A real deployment needs a real database with real transactional
  guarantees, especially for the balance-adjustment ledger.
- No real payment provider — every UPI/crypto/webhook/reconciliation screen is real
  configuration/monitoring scaffolding around a system that has no live processor to
  actually confirm a real-money transaction yet.
- No structured application/system log aggregation beyond the audit log itself.
- No distributed rate limiting (same in-memory limitation as the player API).
- `ADMIN_ALLOWED_ORIGIN`/network isolation for the admin port must be configured by whoever
  deploys this — it is not automatically network-isolated just because it's a different
  port.

This is a real, working, permission-enforced operations center for the game and wallet
system that exists today — not a mockup, and not a claim that it is bulletproof.
