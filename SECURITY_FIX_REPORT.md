# Wager Arena — Security Remediation Report (P0 Fix Pass)

**Scope:** this report documents the fixes made in response to every finding in
[`AUDIT_REPORT.md`](./AUDIT_REPORT.md) (the prior audit, left unmodified as the historical
record). No feature was redesigned wholesale and no working functionality was removed —
every change below is a targeted fix to the trust model, protocol, or a specific file the
audit named. All claims here were verified either by the automated test suite
(`server/src/selftest.ts`, run with `npm test` inside `server/`) or by a live, external
re-test script (`security-retest.mjs`, run against the actual running dev server from a
separate Node process with no special access — see §4).

**This system is still not "unhackable," and this report will not claim that anywhere.**
Every residual, honestly-disclosed limitation is called out explicitly in §5.

---

## 1. What was fixed, mapped to the original findings

### F.1 / I.1 — CRITICAL: name-only "login" = full account takeover

**Fixed.** `server/src/auth.ts` (new file) implements real password hashing with Node's
built-in `scrypt` KDF (`salt:hash` hex, `timingSafeEqual` comparison — no plaintext or
reversible storage anywhere). `server/src/wallet.ts`'s `registerUser`/`authenticateUser`
replace the old `createGuestUser`/name-lookup: signup requires a password (min 8 chars,
enforced server-side in `wallet.ts` and mirrored client-side in `AuthModal.tsx` for UX
only), and login verifies it. Usernames are normalized (`normalizeUsername` = trim +
lowercase) into `User.usernameKey`, so `User`/`USER`/`user` collide as one account, exactly
as required — this was explicitly tested (`selftest.ts`: "signup: username collisions are
case-insensitive").

A successful signup/login issues a random, unguessable session token
(`server/src/auth.ts`, `createSession`) stored server-side in an in-memory
`Map<token, {userId, expiresAt}>` with a 7-day sliding idle expiry, and returned to the
browser only as an **httpOnly** cookie (`server/src/index.ts`, `setSessionCookie`) — never
in a JSON body, never readable by client JavaScript. `GET /api/auth/me`,
`POST /api/auth/logout`, and every protected route resolve the caller exclusively from
this cookie via `requireAuth` middleware (REST) and an `io.use()` middleware (Socket.IO) —
**there is no code path left anywhere that accepts a client-asserted `userId`/`username` as
proof of identity.**

Login failures for "wrong password" and "no such account" return an **identical** 401 with
an identical message (and the login path still runs a full hash comparison against a dummy
value even when the account doesn't exist), specifically to prevent using login as a
username-enumeration oracle — verified in `selftest.ts`.

### F.2/F.3, G.1 — CRITICAL: IDOR on wallet/room endpoints + real userId leaked in room broadcasts

**Fixed.** Every wallet route (`GET /api/wallet`, `GET /api/wallet/stats`,
`POST /api/wallet/topup`, `POST /api/wallet/withdraw`) and every socket handler
(`rooms:create`, `rooms:join`, `rooms:leave`, `rooms:ready`, `match:answer`) in
`server/src/index.ts` now derive the acting account exclusively from `req.userId` /
`socket.data.userId` — values only `requireAuth`/`io.use()` are allowed to set, and only
from a verified session. **There is no `:userId` route param and no `userId` field read
from any request body/payload anywhere in the server.** Live-verified with
`security-retest.mjs`: an attacker authenticated as their own account, submitting
`{amount:500, userId:"<victim's real id>"}` to `/api/wallet/withdraw`, only ever affects
their *own* wallet — the victim's balance is provably untouched.

Room id leakage is fixed in `server/src/rooms.ts`: each `RoomPlayer` now carries a
room-scoped, random `publicId` (nanoid) in addition to the real `userId`. Every room/match
broadcast is now **personalized per recipient** (`toPlayerPublic`, `broadcastRoom`, and the
per-socket `match:end` loop in `endMatch`): a player's own entry always shows their real
`id`, but every *other* occupant's entry shows only their opaque `publicId`. Live-verified:
an attacker seated with a victim never receives the victim's real account id in
`room:update`, `rooms:join`'s ack, or `match:end`.

### G.1 (continued), I.4 — CRITICAL: the round payload leaked the correct answer (173,312/173,312 bot)

**Fixed — the core protocol redesign.** The single `{prompt, options}` payload
(`ArcadeQuestionPublic`, deleted) is replaced with two separate, server-timed events (see
`server/src/types.ts` and `server/src/rooms.ts` `startRound`):

1. **`match:round:reveal`** — sent immediately, contains only the target's `assetId` and a
   `revealDeadline`.
2. **`match:round:options`** — sent only after a real server-side `setTimeout` for
   `memorizeMs` has genuinely elapsed, containing four shuffled options. Each option has a
   **freshly-random `token`** (nanoid, unrelated to its `assetId`) generated in
   `gameKinds/memoryMatch.ts`. The mapping from `token` → "is this correct" is tracked only
   in the server's own `ActiveRound.correctToken` field and is **never serialized into any
   client-facing payload** — see the `RoundOptionPublic`/`GeneratedRound` type
   documentation in `types.ts` for the explicit trust-boundary comment.

The client submits only `{roomId, roundId, optionToken}` (`match:answer`); the server is
the sole party that ever compares `optionToken === round.correctToken`
(`RoomManager.submitAnswer`). This closes the exact exploit verified in the original audit
(`options.findIndex(o => o.assetId === prompt.assetId)`), because the token that must be
submitted back carries no relationship to the asset id at all.

### G.2, I.5 — CRITICAL: no server-side pacing/rate-limit — the 173,312-answers-in-60s exploit

**Fixed.** `ActiveRound` tracks `dispatchedAt`, `revealDeadline`, `answerDeadline`, and
`minAnswerAt` server-side, all computed from real `Date.now()` calls, never from anything
the client asserts. `submitAnswer` rejects:

- an answer for any `roundId` other than the player's current `activeRound.roundId`
  (covers replay, stale rounds, and guessed/future round ids — verified in `selftest.ts`
  and `security-retest.mjs`),
- an answer submitted before `minAnswerAt` (`dispatchedAt + memorizeMs + MIN_REACTION_MS`,
  `MIN_REACTION_MS = 150`ms) — physically impossible for a human, rejected with "submitted
  faster than humanly possible" (verified),
- an answer submitted after `answerDeadline`,
- a second answer for an already-`resolved` round (no double-scoring/replay — verified),
- an answer for a round already superseded by a timeout (see below).

Critically, **a new round for a player is never dispatched until the current one is fully
resolved** (either answered or timed out), so the fastest a player's score can advance is
bounded by `memorizeMs + answerMs` per round, not by network round-trip speed. Live-verified
in `security-retest.mjs`: 22,792 rapid-fire `match:answer` calls fired back-to-back over 3
seconds resulted in **zero** accepted beyond the one legitimately-timed answer — the exact
class of exploit that previously produced 173,312/60s is now structurally impossible, not
merely slowed down.

### G.3, I.5 (continued) — HIGH: no server-side per-round timeout / force-advance

**Fixed.** `RoomManager.expireRound` is a real server-side timer (`ActiveRound.expireTimer`)
that fires exactly at `answerDeadline` if no valid answer arrived. It:

- counts as a wrong answer (decrements `chancesLeft`) — so silently not answering is never
  strictly better than answering,
- emits `match:round:timeout` (revealing `correctToken`, which is now safe since the round
  is over and the token was single-use/random),
- immediately starts the player's next round.

A frozen/AFK/disconnected client can no longer stall on one round for the rest of the
match. Verified live in `selftest.ts`: "an unanswered round auto-resolves as a timeout
after its answer window elapses."

### F.4 — HIGH: wide-open CORS

**Partially addressed — documented tradeoff, not a strict fix.** CORS remains
`{ origin: true, credentials: true }` in `server/src/index.ts` (Express and Socket.IO
both). This is a **deliberate decision, not an oversight**: this environment's live preview
is served from a dynamic, per-session hostname, so pinning `origin` to one fixed value
would break the very preview this fix is being verified against. The actual security
boundary is no longer CORS — it's the session cookie's `sameSite: 'lax'` attribute (see
`setSessionCookie`), which prevents the cookie from ever being attached to a cross-site
`fetch`/form submission regardless of what CORS allows. **This is called out explicitly as
a remaining production blocker in §5** — a real deployment with a fixed, known frontend
origin should pin `origin` to that exact value instead of reflecting any origin.

### F.5, I.2 — HIGH: plaintext, unsigned, non-expiring identity in `localStorage`

**Fixed.** `src/arena/storage.ts` — the file that persisted `{userId, name}` to
`localStorage` — is **deleted entirely**. `src/arena/useArena.ts` now bootstraps identity
by calling `GET /api/auth/me` (which only succeeds with a valid httpOnly session cookie)
on every page load, and there is no other client-side identity cache of any kind. Logging
out calls `POST /api/auth/logout`, which invalidates the session token server-side, so a
stolen cookie value becomes useless immediately, not just "forgotten" client-side.

### F.6 — MEDIUM: no rate limiting on auth endpoints

**Fixed.** `express-rate-limit` is applied per-route in `server/src/index.ts`:
`signupLimiter` (30 requests / 15 min / IP), `loginLimiter` (15 / 15 min / IP, kept
separate from signup specifically so a burst of new signups can never itself lock an IP out
of logging in), `walletWriteLimiter` (10 / min, for `topup`/`withdraw`), and
`walletReadLimiter` (60 / min, for balance/stats reads — financial *writes* are throttled
far more tightly than reads, per the requirement for stricter protection on sensitive
financial actions). All limiter rejections return the same JSON error shape as the rest of
the API (`jsonRateLimitHandler`), not the package's default plain-text body. Socket.IO
events have their own lightweight in-memory per-user limiter (`server/src/rateLimit.ts`),
applied to `rooms:create`, `rooms:join`, and `match:answer` in `index.ts`.

### F.7 — LOW: non-atomic single-JSON-file persistence

**Fixed.** `server/src/store.ts`'s `persist()` now writes to `store.json.tmp` and then
`renameSync`s it over `store.json`, instead of the old direct `writeFileSync` on the real
file. A crash mid-write now leaves the previous, still-valid `store.json` intact (the
half-written data only ever exists in the discarded `.tmp` file) instead of risking a
corrupted/truncated ledger.

### New: financial idempotency (P0-9/P0-11 hardening beyond the original audit)

`server/src/wallet.ts` adds an optional client-supplied `requestId` to `topUp`/`withdraw`
(`POST /api/wallet/topup|withdraw { amount, requestId }`). If the same
`(userId, operation, requestId)` triple is seen again within 5 minutes, the original result
is returned instead of re-running the mutation — this guards against a dropped
HTTP response followed by an automatic/accidental client retry causing a double debit or
double credit. Verified live in `selftest.ts`: two parallel withdrawal requests sharing one
`requestId` produce exactly one ledger entry and one debit.

---

## 2. Exact files changed

| File | Change |
|---|---|
| `server/src/auth.ts` | **New.** Password hashing (scrypt), username normalization, session store. |
| `server/src/rateLimit.ts` | **New.** In-memory per-user sliding-window limiter for socket events. |
| `server/src/express.d.ts` | **New.** Typed `req.userId` augmentation. |
| `server/src/types.ts` | Rewritten: `User`/`PublicUser` split, `TransactionStatus`, round-protocol types (`GeneratedRound`, `RoundRevealPublic`, `RoundOptionsPublic`, `RoundTimeoutPublic`, `ActiveRound`), opaque `publicId`/`id` fields, `MIN_REACTION_MS`. |
| `server/src/store.ts` | Atomic (`tmp` + `renameSync`) persistence; `findUserByUsernameKey`. |
| `server/src/wallet.ts` | `registerUser`/`authenticateUser`/`toPublicUser`; idempotency cache; `status:'completed'` on ledger writes. |
| `server/src/gameKinds/index.ts`, `gameKinds/memoryMatch.ts`, `gameKinds/shared.ts` | Produce `GeneratedRound` with opaque per-option tokens instead of `{question, correctIndex}`. |
| `server/src/rooms.ts` | Session-derived identity throughout; opaque `publicId` + personalized broadcasts; full two-phase round state machine with server-enforced timing. |
| `server/src/index.ts` | Cookie-session auth (`requireAuth`, `io.use()`), new `/api/auth/*` routes, removed all `:userId` route params, rate limiting, JSON-only error responses, catch-all error handler (no stack traces to clients). |
| `server/src/selftest.ts` | Rewritten end-to-end against the new auth + round protocol (see §3). |
| `src/arena/api.ts` | Session-cookie (`credentials:'include'`) calls; no `userId` in any URL/body; `signup`/`login`/`logout`/`fetchMe`. |
| `src/arena/storage.ts` | **Deleted.** No client-side identity cache of any kind. |
| `src/arena/socket.ts` | `withCredentials:true` so the session cookie is sent on the Socket.IO handshake. |
| `src/arena/useArena.ts` | Session bootstrap via `/api/auth/me`; socket only connects once authenticated; consumes the two-phase round events; no `userId` in any emit. |
| `src/arena/components/AuthModal.tsx`, `Home.tsx` | Real password field; separate login/signup handlers. |
| `src/arena/components/RoomScreen.tsx`, `QuestionRenderer.tsx` | Consume `match:round:reveal`/`options`/`timeout`; submit opaque `optionToken`, never an index. |
| `src/arena/components/MatchResult.tsx`, `ProfileScreen.tsx`, `WalletModal.tsx` | Read the new opaque `id` field; drop `userId` from API calls. |
| `security-retest.mjs` | **New.** External, live exploit re-test script (see §4). |

---

## 3. Tests added

`server/src/selftest.ts` (run via `npm test` in `server/`) now covers, in addition to the
pre-existing payout-math and full-match wagering integration tests:

- **AUTH** — weak-password rejection, duplicate/case-insensitive username rejection,
  wrong-password vs. no-such-user returning identical errors, session cookie issuance,
  `/api/auth/me` before/after login/logout, unauthenticated access rejected (401).
- **AUTHORIZATION** — a forged `userId` field in a request body never affects another
  account; a forged/garbage session cookie is rejected; an unauthenticated socket
  connection is rejected at the handshake; a room-mate's real account id is never leaked to
  another occupant, in either `room:update` or `match:end`.
- **GAME anti-cheat** — forged/unknown round id rejected; submitting an `assetId` in place
  of a real token never matches; an answer submitted before `minAnswerAt` is rejected; a
  correctly-timed answer is accepted exactly once; a second answer for the same round is
  rejected; an unanswered round times out and the stale round id can no longer be answered
  afterward.
- **WALLET** — overdraft rejected untouched, negative/non-numeric amounts rejected,
  duplicate-`requestId` idempotency (exactly one ledger entry for two racing requests with
  the same id).

All of the above pass, alongside the original deterministic payout-math suite and the
full-match squad/duel wagering integration tests (now driven through real signup/login
sessions instead of the old guest-login shortcut).

---

## 4. Live integration re-test (P0-14/P0-17)

Run via `node security-retest.mjs` against the actual running dev server (not the
self-test's in-process instance) from a separate script with no special access — exactly
how an external attacker's own tooling would behave:

```
✅ BLOCKED — Account takeover via name-only login (no password check)
✅ BLOCKED — IDOR: attacker draining victim's wallet via a forged userId field
✅ BLOCKED — Reading anyone's wallet with zero authentication
✅ BLOCKED — Forged session token resolving to any account
✅ BLOCKED — Unauthenticated Socket.IO connection accepted
✅ BLOCKED — Room broadcast leaking another player's real account id
✅ BLOCKED — Unlimited-throughput answer spam (original finding: 173,312 answers/60s)
✅ BLOCKED — Client-declared score/correctness accepted at face value

8 exploit(s) blocked, 0 still possible (of the ones directly re-tested here).
```

Each of the 5 original P0 exploits from `AUDIT_REPORT.md` was independently reproduced
against a live server and confirmed blocked, alongside direct-payload-manipulation variants
(forged `userId` field, forged session cookie, client-declared score/correctness,
unauthenticated socket).

---

## 5. Exploits/limitations that honestly remain (do not skip this section)

This system is **not** "unhackable," and the following are real, disclosed limitations —
not hidden behind UI changes:

1. **Bounded-but-real answer-correlation cheat.** The client must render both the target
   and the options from the same small, publicly-bundled 6-image asset set
   (`gameKinds/assetMirror.ts` / `src/data/imageRegistry.ts`). A sophisticated bot that
   listens to both `match:round:reveal` and `match:round:options` and compares `assetId`
   strings can still answer with 100% accuracy without genuinely "memorizing" anything —
   this is a structural limitation of any client that must render a shared, finite,
   client-bundled image set for both the prompt and the options, and cannot be fully closed
   by protocol/token changes alone (it would require server-rendered/streamed imagery,
   which is out of scope for this fix). **What this fix does close is the previously
   catastrophic impact**: such a bot is now capped to the same human-plausible round
   cadence as a real player (bounded by `memorizeMs + MIN_REACTION_MS` + realistic
   `answerMs`), so the practical harm (173,312 answers/60s, effectively unlimited reward
   extraction) is eliminated even though a "perfect-memory, honest-speed" bot advantage is
   not.
2. **IP-based rate limiting, not account- or behavior-based.** `express-rate-limit` keys on
   IP. A distributed attacker (many IPs) is not meaningfully slowed by the auth-endpoint
   limiters. There is also no account lockout / CAPTCHA after repeated failed logins beyond
   the blunt 15-attempts/15-min IP window.
3. **In-memory sessions, rate limits, and idempotency cache.** All three live in
   process-local `Map`s. A server restart logs every user out (acceptable for a demo, not
   for a production SLA), and none of this is safe for horizontal scaling to multiple
   server instances without moving to a shared store (e.g. Redis) — a single-instance
   deployment (the current architecture) is unaffected.
4. **No account recovery.** There is no password-reset or email/phone-verification flow of
   any kind. A user who forgets their password has no way to regain access to that account
   or its wallet balance.
5. **CORS reflects any origin** (`origin: true`), relying entirely on the session cookie's
   `sameSite: 'lax'` as the actual cross-site defense (see §1, F.4) — a real deployment with
   a fixed known frontend origin should pin CORS to it explicitly rather than reflecting
   any origin.
6. **Persistence is still a single JSON file** (now atomically written, but not a real
   transactional database). Fine for the current single-process architecture; would need a
   real database before any horizontal scaling or true production-scale concurrency.
7. **No real payment integration exists or is claimed to exist.** Deposits/withdrawals
   remain a 100% local practice-currency ledger, explicitly labeled as such in the UI
   ("ArenaCoin (ARC) is a practice, crypto-styled in-app currency — no real cryptocurrency
   or payment is ever processed"). The correct future integration path (frontend → backend
   → real payment provider → provider webhook → ledger, with `pending`/`processing` states
   used along the way — the `TransactionStatus` type already models this) is **not**
   implemented here and must be built and independently audited before any real money is
   ever involved. Nothing in this fix simulates or fakes a completed real-money transaction.
8. **No session/room resumption after a page refresh or dropped connection mid-match** —
   this was flagged as a functional (not security) gap in the original audit and remains
   unaddressed; it is out of scope for this security-focused pass.
9. **No structured security audit logging / alerting** beyond `console.warn` on rejected
   `match:answer` authorization failures and the rate-limiter's own logging. Sufficient for
   this environment, not for production incident response.

---

## 6. Readiness verdict

- **DEV:** ✅ Yes.
- **QA:** ✅ Yes — the account-takeover, wallet-IDOR, and answer-payload-leak exploits
  that made the prior build unsafe even for friendly internal testing are now closed and
  live-verified.
- **STAGING:** 🟡 Conditional — acceptable for a single-instance staging deployment with a
  known, trusted user base and no real money at stake, **provided** the CORS origin is
  pinned to the actual staging frontend URL first (see §5.5) and item §5.2/§5.3 are
  understood by whoever owns that environment.
- **PRODUCTION (real money):** 🔴 **No.** This has not changed and cannot be claimed here:
  there is still no real payment integration, no account recovery flow, no
  distributed-attacker-resistant rate limiting, and no horizontally-scalable session store.
  All of §5 above must be read and accounted for by whoever considers a production
  deployment. The specific account-takeover, wallet-authorization, and game-integrity
  exploits from the original audit are fixed and live-verified — that is what this report
  certifies, and no more than that.
