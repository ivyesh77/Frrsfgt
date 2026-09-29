# Wager Arena — Production Readiness & Security Audit

**Scope:** full inspection of `src/` (React client), `server/` (Express + Socket.IO backend), config files, and build tooling, as they exist on branch `arena/01a0ed06-frrsfgt` at the time of this audit. No code was changed to produce this report. Every claim below marked "verified live" was reproduced against the actual running dev server with throwaway scripts (deleted afterward) — this is not a theoretical review.

**Bottom line up front:** the core game loop (question generation, scoring, payout math) is genuinely server-authoritative and well-engineered. But the **authentication model, wallet authorization, and the question payload itself are broken in ways that let anyone drain any wallet and auto-win every match with a 5-line script**. This is a demo/prototype, not a product that can touch even virtual stakes safely in front of untrusted users yet.

---

## 1–9. FEATURE / FUNCTIONALITY / SECURITY AUDIT

### GAME

| Feature | Status | Real functionality |
|---|---|---|
| Main menu (`Home.tsx`) | ✅ COMPLETE | UI ONLY (marketing copy) |
| Game start / matchmaking (`useArena.playAtFee`, `rooms.ts`) | ✅ COMPLETE | SERVER VERIFIED — seats into an open table or creates one, entry fee debited server-side |
| "20 rounds" | 🔴 MISSING as specified | There is no fixed round count. A match is a **60-second live window** (`getMatchDurationMs`) during which each player answers back-to-back questions until they exhaust `STARTING_CHANCES = 5` wrong answers or time runs out. If the user's spec required exactly 20 rounds, that does not exist. |
| Target reveal / memorize phase / target hide | 🟡 PARTIAL | LOCAL LOGIC ONLY. `QuestionRenderer`/`RoomScreen` compute phase (`memorize`→`answer`→`expired`) purely from a local timestamp vs `question.memorizeMs`/`answerMs`. The **server never enforces this timing** (see §5, CRITICAL). |
| Four answers | ✅ COMPLETE | SERVER VERIFIED — `generateMemoryMatch()` always returns 1 target + 3 distractors, shuffled |
| Randomization | ✅ COMPLETE | `shuffle()` uses `Math.random()` (fine for a non-cryptographic game shuffle) |
| Correct answer validation | ✅ COMPLETE | SERVER VERIFIED — `correctIndex` is generated and held server-side in `activeQuestions`, never sent to the client (see `ArcadeQuestionPublic` — no `correctIndex` field) |
| Wrong answer handling | ✅ COMPLETE | Decrements `chancesLeft`, server-tracked |
| Timeout handling | 🔴 MISSING / ⚠️ UNSAFE | **Verified live**: if a client never answers a dispatched question, the server never force-expires it. A stalled/frozen/AFK player gets stuck on question #1 for the entire 60-second match while an actively-playing opponent cycles through many questions. No `setTimeout` in `rooms.ts` ever calls `dispatchNextQuestion` or penalizes a non-response. |
| Scoring | ✅ COMPLETE | SERVER VERIFIED, server-side `player.score` |
| Streak | 🔴 MISSING | No streak concept exists anywhere in the code (`correct`/`wrong` counters exist, no consecutive-streak tracking or bonus) |
| Difficulty | 🔴 MISSING | Single fixed difficulty; no scaling, no levels |
| Timer (match + per-question) | 🟡 PARTIAL | Match countdown is server-driven (`matchEndsAt`, good). Per-question timer is **client-only cosmetic**, not enforced (see above) |
| Response time tracking | 🟡 PARTIAL | `lastAnswerAt` is recorded and used only as a tie-breaker in payout ranking; not shown to the player, not used for a "reaction speed" score |
| Result screen | ✅ COMPLETE | `MatchResult.tsx`, SERVER VERIFIED payout numbers |
| Replay | 🟡 PARTIAL | No literal "Play again" button — "Back to Lobby" → pick a stake again achieves the same end result, but it's an extra step |
| Game reset / state machine | ✅ COMPLETE | `waiting → countdown → live → finished`, clean reducer in `useArena.ts` |
| Sound | 🔴 MISSING | Zero audio anywhere in the codebase (`grep` for audio/sound/music: no hits) |
| Music | 🔴 MISSING | Same as above |
| Haptics | 🔴 MISSING | No `navigator.vibrate` anywhere |
| Animations | ✅ COMPLETE | `framer-motion` used across 6 components; genuinely working |
| Particles | 🔴 MISSING | None |
| Responsive UI | 🟡 PARTIAL | Viewport meta present; only **one** explicit `@media` breakpoint in the entire codebase (`arena.css:479`, for `RoomScreen`'s two-column layout collapsing at 720px). Lobby/Home/WalletModal/ProfileScreen rely entirely on flex-wrap/CSS-grid `auto-fill` for "implicit" responsiveness — plausible but never explicitly verified on narrow viewports (no device testing tool available in this sandbox to confirm). |
| Keyboard/touch controls | 🟡 PARTIAL | Modals close on `Escape` (`AuthModal`, `WalletModal`); the actual game (answer buttons) has no keyboard binding (1/2/3/4 keys), touch works because it's just `<button onClick>` |
| Local persistence | 🟡 PARTIAL | Only the `{userId, name}` "identity" is persisted (`localStorage`, key `memory-match:arena-identity:v1`), used purely for auto-login convenience — see §4 for why this is also the root of the auth vulnerability |

### WALLET

| Feature | Status | Real functionality |
|---|---|---|
| Wallet home / balance display | ✅ COMPLETE | API CONNECTED, always fetched fresh from server, never cached/trusted from `localStorage` (this part is done right) |
| Pending balance | 🔴 MISSING | No concept of "pending" anywhere — every operation is instantly final (success or hard 400 failure) |
| Deposit ("top-up") | 🟡 PARTIAL / 🧪 DEMO ONLY | API CONNECTED but **not a real payment integration** — `POST /api/wallet/:userId/topup` just credits the ledger for whatever `amount` the client sends. This is explicitly and honestly disclosed in the UI ("ArenaCoin (ARC) is a practice, crypto-styled in-app currency — no real cryptocurrency or payment is..."), so it is not *deceptive*, but it must not be mistaken for "deposit works." |
| Withdraw | 🟡 PARTIAL / 🧪 DEMO ONLY | Same as above — server checks `amount > 0`, `amount <= 100,000`, and sufficient balance, then just debits the ledger. No payout ever leaves the system. |
| UPI | 🔴 MISSING | Zero UPI code/SDK/provider anywhere (`grep -i upi` → no hits outside this report) |
| Crypto | 🔴 MISSING | Zero blockchain/wallet-address/signature code anywhere. "ArenaCoin" is a themed name for the same in-memory ledger, not an actual token/chain |
| Transaction history | ✅ COMPLETE | SERVER VERIFIED, real ledger (`getTransactionsForUser`, capped to last 25 for the UI feed) |
| Transaction detail | 🟡 PARTIAL | List view only shows type/amount/timestamp/balance-after; no dedicated per-transaction detail view/receipt |
| Payment methods | 🔴 MISSING | Only one "method": the practice ledger. No method selection UI, no provider abstraction |
| Security (wallet) | ⚠️ UNSAFE | See §4/§6 — CRITICAL. Any known `userId` can withdraw/deposit on any account with zero authentication |
| Limits | 🟡 PARTIAL | Only a hardcoded `amount <= 100_000` per single transaction server-side; no daily/weekly caps, no KYC tiering, no per-account velocity limits |
| Notifications/status | 🔴 MISSING | No push/email/SMS notification system; only an in-page toast for immediate errors |
| Validation | 🟡 PARTIAL | Amount sanity checks exist server-side (finite, positive, capped, sufficient balance) — reasonable for what it is, but see IDOR above: validation of the **amount** is fine, validation of **who is allowed to act** is absent |
| Fees | 🔴 MISSING (wallet-level) | No deposit/withdrawal fee modeled (only the 20% platform cut on *match pools*, which is a different thing and works correctly) |
| Pending/processing/success/failed/reversed states | 🔴 MISSING | The `TransactionType` union is `topup \| withdrawal \| entry_fee \| refund \| payout \| platform_fee \| signup_bonus` — there is no `pending`, `processing`, `failed`, or `reversed` state anywhere in the type system or UI. Every wallet action is synchronous and binary (200 or 400). This is fundamentally incompatible with any real payment rail (UPI/crypto are inherently asynchronous with pending/failed/reversed states). |

---

## 2. REAL FUNCTIONALITY CHECK — summary

| Layer | Classification |
|---|---|
| Question generation, correct-answer check, score, chances, payout math | **SERVER VERIFIED** (genuinely trustworthy, cannot be tampered with directly) |
| Match pacing (memorize/answer timing) | **LOCAL LOGIC ONLY** — cosmetic, not enforced (exploitable, see §5) |
| Wallet balance display | **API CONNECTED** to a real (if simplistic) ledger |
| Deposit/withdrawal "success" | **LOCAL/MOCK** — no external provider; the "success" is just this server's own ledger write, not a payment rail confirmation |
| Auth ("login"/"signup") | **API CONNECTED but not authentication** — see §4, this is name-lookup, not identity verification |
| Room membership / entry fee debit | **SERVER VERIFIED**, but **authorization is missing** — the server verifies *the amount* and *the room state*, never *that the caller is actually the named user* |

---

## 3. DEV/TEST/PRODUCTION SEPARATION

- **No environment files at all.** No `.env`, `.env.example`, or `import.meta.env.VITE_*` usage anywhere in the client. `server/src/types.ts` reads `process.env.ARCADE_MATCH_DURATION_MS` / `ARCADE_READY_COUNTDOWN_MS` purely so the self-test suite can shrink match duration — **there is no equivalent `NODE_ENV`/config split for anything security-relevant** (CORS, data file location, auth, logging level).
- **CORS is wide open in all environments**: `app.use(cors({ origin: true, credentials: false }))` and Socket.IO `cors: { origin: true }` reflect *any* request origin, unconditionally, in server/src/index.ts:12–19. There is no dev/staging/production distinction.
- **`vite.config.ts`'s `/api` and `/socket.io` proxy to `localhost:8787` only works inside the Vite dev server.** A real production build (`vite build` → static `dist/`) has **no equivalent** — nothing rewrites `/api/*` to the backend once Vite's dev server is gone. This currently "works" only because this sandbox's preview always runs the Vite dev server, never a built+served bundle.
- **No feature flags** of any kind.
- **No staging vs production endpoint distinction** — there's only ever one backend URL, hardcoded to `localhost:8787` in the proxy config.
- Console logging: server logs a single startup line (`Memory Match arcade server listening on :PORT`) and the self-test suite's own `console.log` assertions — **acceptable**, nothing sensitive is logged, and the self-test file never runs in the actual server process. No client-side `console.log` at all (checked, zero hits).
- No test credentials, debug buttons, or "always succeed" bypasses were found baked into the shipped UI — the danger here is not "there's an obvious cheat button," it's that **the real security boundary (auth) was never built**, so no bypass is even necessary.
- `server/src/store.ts` exports `__resetStoreForTests()` — this is dev/test-only, but it is **not gated behind any HTTP route**, so it cannot be triggered remotely; it is only ever called from `selftest.ts`. Fine as-is, but flagging because it is exported from the same module that ships in the production server bundle (dead but harmless code).

---

## 4. SECURITY AUDIT

### 🔴 CRITICAL — No real authentication; "login" is a bare name lookup (account takeover)

- **File:** `server/src/index.ts:29-49` (`POST /api/auth/guest`), `server/src/store.ts:47` (`findUserByName`)
- **Problem:** There is no password, token, or any secret. `mode: 'login'` does a case-insensitive lookup by **display name only** and, if found, returns that account's full user object (id + wallet balance) to whoever asked. **Verified live**: signed up as `ShortName15`, then from a separate "attacker" request logged in with `SHORTNAME15` (different case, no credential) and received the identical `id`/wallet — full account control.
- **Severity:** CRITICAL
- **Why it matters:** Any two people who pick the same/guessable display name — or anyone who simply knows another player's name (visible in every room's player list, leaderboard, and match result) — can fully impersonate them: view balance, deposit/withdraw, join rooms as them, and see their transaction history. This is a complete authentication bypass, not an edge case.
- **Recommended fix:** Replace name-based "login" with real credentials: require a password (hashed with bcrypt/argon2) or an OAuth/OTP flow, issue a signed, short-lived session token (JWT or opaque session id backed by a server-side session store) on successful login, and require that token (via `Authorization` header or httpOnly cookie) on every subsequent request. Stop returning or accepting a bare `userId` as proof of identity anywhere.

### 🔴 CRITICAL — IDOR: every wallet/room-membership endpoint trusts a client-supplied `userId` with zero ownership check

- **Files:** `server/src/index.ts` (`GET /api/wallet/:userId`, `GET /api/wallet/:userId/stats`, `POST /api/wallet/:userId/topup`, `POST /api/wallet/:userId/withdraw`); `server/src/rooms.ts` (`rooms:join`, `rooms:leave`, `rooms:ready`, `match:answer` socket handlers, all of which accept `payload.userId` at face value)
- **Problem:** None of these routes/handlers verify that the request is actually coming from the account holder. They only check "does a user with this id exist" and "is the amount/state valid."
- **Verified live end-to-end:** created two accounts (victim, attacker), had the attacker join the same room as the victim, and confirmed the join acknowledgement / `room:update` broadcast includes the victim's **real `userId`** in plaintext (`RoomPlayerPublic.userId`, `server/src/types.ts:139`). The attacker then called `POST /api/wallet/<victim's leaked id>/withdraw` directly and it succeeded (HTTP 200) — the victim's balance dropped by the stolen amount with no consent, no notification, no verification. The attacker also called `rooms:ready` using the victim's id and force-readied them into a match against their will.
- **Severity:** CRITICAL
- **Why it matters:** This is a live, working wallet-drain exploit plus a griefing vector (force ready/leave other players), reachable by anyone who can see a userId — which happens automatically just by being in the same room. No devtools tricks or unusual access are needed; two ordinary `fetch()`/socket calls are sufficient.
- **Recommended fix:** (1) Stop broadcasting real userIds to other room occupants — use an opaque per-room display handle if the UI needs to distinguish players, or accept that occupants can see names but never raw account ids. (2) More importantly: every REST route and socket handler that mutates or reads account-specific data must derive the acting user from an authenticated session (see previous fix), not from a client-supplied `userId` field, and must verify `session.userId === payload.userId` (or simply ignore `payload.userId` and use `session.userId`) before doing anything.

### 🔴 CRITICAL — The question payload leaks the correct answer's identity, trivially defeating the whole game (and its wagers)

- **Files:** `server/src/gameKinds/memoryMatch.ts` (`generateMemoryMatch`), `server/src/rooms.ts:220-229` (`dispatchNextQuestion`), `src/arena/components/QuestionRenderer.tsx`
- **Problem:** The server never sends the `correctIndex` — good — but it sends the **target's `assetId`** in `prompt.assetId` and all four candidates' `assetId`s in `options[].assetId` **in the same payload, at the same time**. The correct option is therefore whichever option's `assetId` equals the prompt's `assetId` — derivable with one line of JavaScript, with no need to ever look at an image or "memorize" anything.
- **Verified live with a scripted "bot"**: a socket client that computed `options.findIndex(o => o.assetId === prompt.assetId)` and auto-answered scored **173,312/173,312 (100%)** correct answers inside a single 60-second match (the honest opponent, deliberately playing normally, scored 3). The bot's account **won real in-app currency** from the match (balance went from 1000 → 1030 after a 50-coin entry fee, i.e. a real payout was credited by the server for a fully mechanical, zero-skill "win").
- **Severity:** CRITICAL
- **Why it matters:** This is not a theoretical timing side-channel — it is the literal data needed to win, sent directly to the client. Combined with the pacing gap below, this makes the entire wagering premise (a skill/memory game with real stakes) worthless: anyone running a small script wins every match, every time, and gets paid by the server for it.
- **Recommended fix:** Never send any field on `options` that can be string/ID-matched against `prompt`. Either (a) send the options' *rendering data* (e.g. pre-resolved image URLs) but with the target's identity obscured — genuinely hard to do robustly — or, better, (b) restructure so the client never receives enough information to determine correctness client-side at all: send the prompt only during the memorize phase, then send the options as an **opaque, per-answer-slot token** (not the real assetId) during the answer phase, and only the server (which still holds the true mapping from token → asset) evaluates the submitted index. The server already does the actual correctness check itself — it just needs to stop handing the client the answer key alongside the question.

### 🔴 CRITICAL — No server-side pacing/rate-limit on `match:answer`; the match "timer" only limits wall-clock time, not throughput

- **File:** `server/src/rooms.ts:220-267` (`dispatchNextQuestion`, `submitAnswer`)
- **Problem:** As soon as one answer is processed, the very next question is dispatched immediately, with no minimum delay. There is no cap on how many question/answer round-trips can happen inside the 60-second match window.
- **Verified live:** the same bot above completed **173,312** question/answer cycles in 60 seconds over a real network round trip (loopback, but still bound by actual socket I/O) — several thousand times more than the ~10 questions/minute the UI's `memorizeMs`(1800) + `answerMs`(4200) timings imply a human/legit client would ever produce.
- **Severity:** CRITICAL (compounds the answer-leak above into an effectively unlimited-score/unlimited-"skill" exploit)
- **Why it matters:** Even if the answer-leak above were fixed, this remains a distinct problem: nothing stops a legitimate-looking client from submitting answers far faster than the intended game pace, which would still let scripted play dominate scoring/ranking.
- **Recommended fix:** Enforce the question lifecycle server-side: record `dispatchedAt` per active question, reject (or at minimum flag/ignore-for-ranking) any `match:answer` received before `dispatchedAt + memorizeMs` (too fast to have "seen" it) or after `dispatchedAt + memorizeMs + answerMs + reasonableNetworkSlack` (expired — see the Timeout finding above, which should also be fixed by this same mechanism: force-advance to the next question when the window elapses unanswered).

### ⚠️ UNSAFE — Wide-open CORS (`origin: true`) with no auth tokens

- **File:** `server/src/index.ts:12`, `:18`
- **Problem:** Any website on the internet can call this API from a visitor's browser (no cookie-based credentials are used, so classic CSRF-via-cookie doesn't directly apply, but since "authentication" is just a plaintext `userId` string, any origin's JavaScript can `fetch()` these endpoints directly — there is no origin restriction at all).
- **Severity:** HIGH (compounds directly with the IDOR above — this is *why* the IDOR is exploitable from literally anywhere, not just from within this app's own frontend)
- **Recommended fix:** Once real auth/session tokens exist, restrict CORS to the known frontend origin(s) explicitly, and rely on the session token (not the open CORS policy) as the actual security boundary.

### ⚠️ UNSAFE — Client identity persisted as plaintext, unsigned JSON in `localStorage`

- **File:** `src/arena/storage.ts`
- **Problem:** `{ userId, name }` is stored unsigned, unencrypted, with no expiry. Anyone with script execution in the page (XSS — none found today, but this is the blast radius if one is ever introduced) or physical/browser access to the device can read and reuse it forever, and combined with the missing session model, this pair is effectively a permanent bearer credential.
- **Severity:** HIGH
- **Recommended fix:** Store only a short-lived, server-issued session token (ideally an httpOnly cookie, which JS — and therefore XSS — cannot read at all); never store the raw account id as if it were a credential.

### Other security notes (LOW/MEDIUM, verified)

- **Double-spend / race conditions on withdraw:** ✅ **NOT exploitable** — verified live by firing 10 parallel `withdraw(200)` requests against a 1000 balance; exactly 5 succeeded and the final balance was exactly 0. Node's single-threaded, synchronous-per-request handling in `wallet.ts` protects this today. **Caveat:** this safety is incidental to the current single-process, synchronous-file-store architecture, not a designed guarantee — it will silently break the moment the store becomes async (a real database) or the server is horizontally scaled, unless an explicit lock/transaction is introduced then.
- **Room capacity race:** ✅ **NOT exploitable** — verified live with 5 parallel joins to a 2-capacity duel room; exactly 2 succeeded. Same caveat as above.
- **Duplicate/replay answer submission:** ✅ handled — `rooms.ts:238-241` rejects an answer whose `questionId` doesn't match the player's current outstanding question.
- **No rate limiting on auth/login endpoints:** 🔴 missing — `POST /api/auth/guest` has no throttling, enabling unlimited name-guessing/account-hijack attempts (compounds the CRITICAL auth finding above) and unlimited account creation (spam).
- **No input length/content sanitation beyond a 24-char slice on `name`:** names are stored and later rendered as plain text in React (`{p.name}`), which auto-escapes — no XSS via name injection was found, but there is no profanity/format filtering either (cosmetic, LOW).
- **No helmet/security-headers middleware, no request size limits beyond Express defaults, no HTTPS enforcement at the app layer** (expected to be handled by a reverse proxy in real deployment, but nothing here even models for it).

---

## 5. GAME SECURITY — summary judgment

The **scoring, correctness-check, and payout arithmetic** are genuinely server-authoritative and were not found to be manipulable via DevTools/localStorage/React-state editing — that part of the architecture is sound:

```
CLIENT (sends only choiceIndex + questionId)
   ↓
GAME SESSION (Room, in-memory, server-held activeQuestions map)
   ↓
SERVER VALIDATION (correctIndex comparison happens only in rooms.ts)
   ↓
RESULT VERIFICATION (computeMatchPayout, pure/deterministic, unit-tested)
   ↓
REWARD/LEDGER ACTION (creditPayout/refundEntryFee, server-only wallet mutation)
```

This is the right shape. **However, the CRITICAL findings in §4 above (answer-payload leak + no pacing + missing per-question timeout) mean the "skill" the payout is supposedly rewarding does not actually have to be exercised at all** — a trivial script wins every match. The architecture is server-authoritative for *arithmetic*, but not for *the actual game-play signal* it is paying out for. Do not claim this is "unhackable" even after the recommended fixes — only that the two concrete, demonstrated exploits above would be closed.

---

## 6. WALLET SECURITY — summary judgment

```
frontend  →  "secure" API  →  backend (in-memory + JSON file)  →  [no provider]  →  [no webhook]  →  ledger  →  updated wallet
```

- The **arithmetic** of a wallet mutation (balance can't go negative, amount bounds checked) is enforced server-side — the browser cannot directly edit a balance.
- But **"who is allowed to trigger a mutation" is not enforced at all** (§4 CRITICAL) — so despite the math being server-side, the *authorization* is not, which in practice is just as bad: an attacker doesn't need to forge a balance number, they just call the real endpoint as if they were someone else.
- There is **no external provider integration of any kind** — deposits/withdrawals are 100% local ledger writes. This is fine for a disclosed practice-currency demo (and it is disclosed), but it must never be described as "wallet works" in a payments sense — there is no webhook, no signature verification, no reconciliation, because there is no external system to reconcile with yet.
- **Any place where the frontend can just declare success?** Not directly — the "success" response the frontend renders is a real 200 from the server, not a client-invented state. The flaw is one layer back: the server itself will say "success" to an unauthorized caller just as readily as an authorized one.

---

## 7. PAYMENT AUDIT

| | UPI | Crypto |
|---|---|---|
| Classification | 🔴 **MISSING** (not even mocked with UI-only flow — there is no UPI-specific UI at all) | 🧪 **DEMO / theming only** — "ArenaCoin (ARC)" is a cosmetic name and a fake `ARC-xxxxxxxxxx` id string (`coinWalletId()` in `src/arena/types.ts`), not a real address on any network |
| Provider | none | none |
| API integration | none | none |
| Order/payment creation | none | N/A — deposits are a direct ledger credit |
| Callback/webhook | none | none |
| Signature verification | none | none |
| Server-side verification | N/A (nothing to verify against) | N/A |
| Duplicate protection | N/A | N/A |
| Timeout/expired-payment handling | N/A (everything is synchronous) | N/A |
| Refund/reversal handling | Only for **in-game** refunds (void match / leaving a waiting room) — nothing for a payment-provider-level reversal, because there is no provider | same |
| Reconciliation | none | none |
| Asset/network/deposit address/tx hash/confirmations/network-mismatch protection | N/A | **all missing** — there is no real address, no chain, no confirmations concept anywhere |

**Overall payment integration maturity: DEMO.** Not sandbox (no provider sandbox is wired up), not integration-ready (no provider SDK, no webhook endpoint scaffolding, no idempotency-key handling that a real integration would need), and obviously not live. This is accurately reflected in the UI's own disclaimer text, which is good — the risk is only if this gets deployed and mistaken for a working payment feature by anyone who doesn't read the disclaimer or if the disclaimer is later removed without the underlying gap being closed.

---

## 8. CODE QUALITY AUDIT

- **Component sizes are reasonable** — largest non-test file is `server/src/rooms.ts` (332 lines) and `src/arena/useArena.ts` (339 lines); no multi-thousand-line "god components" were found. `useArena.ts` does combine auth + wallet + room + socket-wiring concerns into a single hook — not urgent, but a candidate to split into `useAuth`/`useWallet`/`useRoom` if the app keeps growing.
- **No `any` casts anywhere** in `src/` or `server/src/` (checked via grep) — typing discipline is good, `strict` + `noUncheckedIndexedAccess` are both on in `tsconfig.app.json`.
- **Duplicated logic:** minor — `coinWalletId`/`initialsOf` helpers were already centralized in `src/arena/types.ts` in the last change; no other meaningful duplication found this pass.
- **Timers/intervals:** `useNow.ts` recomputes from real `Date.now()` timestamps (not tick-counting), which correctly avoids drift; all `setInterval`/`setTimeout` usages found have matching cleanup (`ArenaApp`'s lobby poll, `AuthModal`/`WalletModal` keydown listeners, `Room.clearTimers()` on the server). No leaks found in this pass.
- **Error boundaries:** 🔴 **none exist** (`grep` for `ErrorBoundary`/`componentDidCatch` — zero hits). Any uncaught render error anywhere in the tree currently white-screens the whole app with no recovery UI.
- **Persistence layer (`server/src/store.ts`):** a single JSON file rewritten **in full, synchronously, on every single mutation** (`writeFileSync` of the entire `db` object). No atomic write (no write-to-temp-then-rename), so a crash mid-write can corrupt `store.json` (the load path does catch a corrupt-JSON parse and resets to empty — meaning a crash mid-write could **silently wipe every user's wallet and history** rather than merely fail to save). Not a real database: no transactions, no indices beyond an in-memory object, no backups.
- **Dependencies:** `npm audit` reports **0 known vulnerabilities** in both `package.json`s at the time of this audit — good, but this only covers known CVEs in third-party packages, not the architectural issues above.
- **No CI pipeline** (`.github/workflows` does not exist) — lint/typecheck/tests are only ever run manually.
- **No client-side automated tests at all** — `server/src/selftest.ts` (577 lines) is a solid ad-hoc integration-test suite that spins up the real server and drives it via real sockets/HTTP (54 assertions, all passing as of this audit), which is good practice for the backend, but there is zero test coverage of any React component or the `useArena` reducer.

---

## 9. REAL-WORLD EDGE CASES — tested

| Scenario | Result |
|---|---|
| Rapid parallel withdraw requests (double-spend attempt) | ✅ Safe — verified live, exactly the affordable number succeeded, final balance exactly 0, no negative balance |
| Rapid parallel joins to a capacity-limited room | ✅ Safe — verified live, exactly `maxPlayers` succeeded |
| Duplicate/stale answer submission | ✅ Rejected server-side (`questionId` mismatch check) |
| A player who never answers (frozen/AFK/closed laptop) | 🔴 **Bug, verified live** — gets stuck on the same question for the rest of the match; never force-advanced, never penalized by a timeout |
| Refresh / browser back-forward during a live (paid) match | 🔴 **Not handled** (verified by code inspection — no code path persists or recovers a `roomId` across a page reload; `useArena`'s only bootstrap effect re-fetches the wallet, not "what room was I in"). Entry fee has already been debited; after a refresh the player lands back in the lobby with no way to rejoin the room they paid into, other than the server-side "reconnect" branch in `joinRoom` — which nothing on the client ever calls automatically. |
| Socket disconnect/reconnect mid-match (network blip) | 🔴 **Not handled** — same root cause as above; Socket.IO's client auto-reconnects with a new `socket.id`, but nothing re-emits `rooms:join` to re-attach, so the player is left server-side marked `connected: false` for a live match (no refund per the code's own design), with no client-side recovery flow. |
| Malformed/missing image asset | 🟡 Silently renders nothing (`OptionContent`/`PromptPanel` return `null` if the asset id isn't found) — no visible broken-image icon, but also no error surfaced; a genuinely missing asset in production would show a blank tile with no explanation. |
| Offline / slow network | 🔴 Not handled — no `navigator.onLine` checks, no offline banner, no retry-with-backoff (only a passive "next poll will retry" comment for the lobby list poller) |
| Login attempted for a name that doesn't exist / signup for a taken name | ✅ Handled with clear 404/409 errors surfaced in the auth modal |
| Long display name at signup (>24 chars) | 🟡 **Minor functional bug, verified live** — the server silently truncates stored names to 24 characters at signup, but the login lookup compares against the *un-truncated* input the user later types. A user who originally signed up with a name over 24 characters (nothing in the UI prevents this) can become unable to log back in with the name they think they used, because the stored (truncated) name no longer matches what they type. |

---

## 10. PRODUCTION READINESS

- **Build:** ✅ `npm run build` succeeds cleanly (`tsc -b && vite build`), no warnings.
- **Lint:** ✅ `oxlint` — 0 warnings, 0 errors.
- **TypeScript:** ✅ `tsc -b --noEmit` (root) and `tsc --noEmit` (server) both clean, with `strict` + `noUncheckedIndexedAccess` enabled — good hygiene.
- **Server self-tests:** ✅ 54/54 assertions pass (`npm test` in `server/`).
- **Dependency vulnerabilities:** ✅ 0 reported by `npm audit` in either package.
- **Runtime/console errors during manual smoke testing:** none observed.
- **Environment configuration:** 🔴 absent (see §3) — CORS, proxy target, data file path are all hardcoded, no dev/stage/prod split.
- **Source maps:** not explicitly configured; Vite's production default (no client sourcemaps) applies, which is fine for not leaking source in prod, but also means production error reports would be hard to debug without adding them back behind a controlled upload step.
- **Production logging/observability:** 🔴 none (no request logging middleware, no error tracking/Sentry-equivalent, no structured logs)
- **Error handling / loading states in UI:** 🟡 partial — a global error toast exists (`ArenaApp.tsx`), and most async actions have loading/disabled states, but there is no error boundary for render-time crashes and no offline/retry UX (see §9).
- **Accessibility:** 🟡 partial — 37 `aria-*`/`role` attributes present, `prefers-reduced-motion` respected globally, but no dedicated a11y pass (no keyboard-only playthrough verified, color-only feedback risk on answer highlighting not checked against WCAG contrast).
- **Responsive behavior:** 🟡 thin (one explicit breakpoint; rest relies on implicit flex/grid reflow — plausible but unverified on real narrow viewports in this environment).
- **Performance:** not load-tested; single-process, single-JSON-file backend has an obvious ceiling (every wallet/transaction write serializes and rewrites the *entire* ledger file) but was not stress-tested at scale in this pass.
- **Deployment topology:** 🔴 the current `/api` + `/socket.io` reverse-proxy setup only exists inside Vite's *dev* server (`vite.config.ts`). There is no equivalent for a real production deployment (e.g., an Nginx config, a Node server that serves `dist/` *and* proxies API calls, or an absolute `VITE_API_URL`). Deploying `dist/` as a static site today would break all API/socket calls outside of this specific sandboxed preview.

### READINESS VERDICT

- **READY FOR DEV:** ✅ Yes — it runs, builds, lints, and type-checks cleanly, and is genuinely pleasant to develop against.
- **READY FOR QA:** 🟡 Marginal — QA can exercise the happy paths, but should be explicitly told the auth/wallet-security holes exist so they don't "pass" the app on functional grounds alone.
- **READY FOR STAGING:** 🔴 No — staging implies exposing it to more than the development team; the account-takeover and wallet-IDOR bugs make that unsafe even for internal/friendly testing with real (even virtual) balances at stake, and there is no environment separation to stand up a staging config safely in the first place.
- **READY FOR PRODUCTION:** 🔴 **No.** A successful `npm run build` is not evidence of production-readiness here — the authentication model, wallet authorization, and the game's answer-payload design must be fixed first (see P0 list below). Separately, there is no real payment integration at all, so "production" in the sense of handling real money is not applicable to the current codebase regardless of the security fixes — that would be new integration work, not a bug fix.

---

## 11. OUTPUT SUMMARY

**A. WHAT IS ALREADY COMPLETE**
Casino-style lobby with stake tiers and format filter; server-authoritative question generation, scoring, chances, and payout math (unit-tested and verified un-exploitable via race conditions); real (if simplistic) transaction ledger with lifetime stats; Profile screen; full deposit/withdraw UI flow (against the practice ledger); clean TypeScript/lint/build pipeline; solid backend integration test suite (54 passing assertions).

**B. WHAT IS PARTIAL / MOCK**
Per-question timing (client-cosmetic only, not server-enforced); deposit/withdrawal (real ledger writes, zero external payment provider — openly disclosed as practice currency); responsive design (works via implicit CSS flow, only one explicit breakpoint); replay flow (works via an extra step, no direct "play again"); accessibility (present but shallow); loading/error states (present for network calls, absent for render crashes).

**C. WHAT IS MISSING**
Real authentication (passwords/sessions/tokens); server-side per-question timeout/force-advance; streak, difficulty scaling, sound, music, haptics, particles; UPI and crypto provider integration of any kind; pending/processing/reversed wallet states; rate limiting anywhere; error boundaries; environment/config separation; CI pipeline; production reverse-proxy/deployment config; offline handling; session/room resumption after refresh or reconnect.

**D. WHAT IS DEV/TEST ONLY**
`ARCADE_MATCH_DURATION_MS`/`ARCADE_READY_COUNTDOWN_MS` env-var overrides (only meaningfully used by `selftest.ts`); `__resetStoreForTests()` (exported but not reachable via any route); the entire self-test suite itself (`npm test`, never runs in the production process).

**E. WHAT IS PRODUCTION-READY**
The payout arithmetic (`payout.ts`) — pure, deterministic, thoroughly unit-tested. The core Socket.IO room lifecycle for capacity/race-safety (verified, with the caveat noted about the current synchronous-single-process assumption). The TypeScript/build/lint tooling setup itself.

**F. SECURITY VULNERABILITIES / EXPLOITABLE TRUST POINTS** — see §4 in full; summarized:
1. CRITICAL — name-only "login" = full account takeover, no password ever existed.
2. CRITICAL — IDOR on every wallet/room endpoint; any leaked/known `userId` grants full control of that wallet.
3. CRITICAL — room broadcasts leak every occupant's real `userId` to every other occupant, directly enabling #2.
4. HIGH — wide-open CORS with no auth tokens turns #2/#3 into an any-origin exploit.
5. HIGH — plaintext, unsigned, non-expiring identity in `localStorage`.
6. MEDIUM — no rate limiting on auth endpoints (brute-force/enumeration/spam signup).
7. LOW — non-atomic single-JSON-file persistence; a crash mid-write can wipe all data.

**G. GAME LOGIC RISKS**
1. CRITICAL — the question payload leaks the correct answer's identity (`assetId` match), verified to produce a 100%-accuracy, zero-skill auto-win bot that gets paid real in-app currency.
2. CRITICAL — no server-side pacing/rate-limit on answers; a script can play thousands of times faster than the intended pace within one match window.
3. HIGH — no server-side per-question timeout; an unresponsive client freezes on one question for the whole match instead of being force-advanced.
4. MEDIUM — no reconnection/resume flow for a dropped connection or page refresh during a paid live match.

**H. WALLET/PAYMENT RISKS**
1. CRITICAL — authorization gap described in F.2/F.3 applies fully to deposit/withdraw endpoints — this is a real wallet-drain exploit today, even though the currency itself is virtual.
2. HIGH — zero external payment provider integration for UPI or crypto exists; anything suggesting otherwise (naming/theming) must stay clearly labeled as a demo, or the feature must not ship as "payments" at all.
3. MEDIUM — no pending/processing/reversed transaction states, which is structurally required before any real payment rail could be plugged in.
4. LOW — no configurable limits/fees/KYC tiers.

**I. CRITICAL FIXES REQUIRED BEFORE PRODUCTION**
1. Real authentication with passwords/OTP and server-issued session tokens; stop trusting a bare `userId` as identity.
2. Authorize every wallet and room-mutation endpoint against the authenticated session, not a client-supplied id.
3. Stop broadcasting real user ids to other room occupants.
4. Redesign the question payload so the client never receives data sufficient to derive the correct answer (move the correctness signal fully server-side, per-answer-slot opaque tokens).
5. Enforce question pacing/timeout server-side (minimum/maximum time between dispatch and answer; force-advance on timeout).
6. Restrict CORS to known origins once sessions exist.

**J. NON-CRITICAL POLISH REMAINING**
Sound/music/haptics/particles, streak & difficulty systems, dedicated "Play Again" shortcut, transaction detail view, notification system, error boundary, offline/retry UX, session/room resumption after refresh, more responsive breakpoints, CI pipeline, production deployment/reverse-proxy configuration, moving off a single JSON file to a real database, request logging/observability, the 24-character name truncation/login mismatch bug.

**K. FINAL READINESS: DEV** (usable for continued internal development only — not QA, staging, or production until the P0 items in the remediation list are addressed).

---

## 12. PRIORITIZED REMEDIATION LIST

**P0 — must fix before any environment beyond solo local development:**
- Replace name-based login with real authentication + server-issued session tokens.
- Bind every wallet/room-mutation endpoint (REST + socket) to the authenticated session; stop trusting client-supplied `userId`.
- Stop leaking real user ids in room broadcasts.
- Fix the question-payload data leak (remove the client's ability to derive the correct answer from the payload it's given).
- Enforce question timing/pacing server-side, including force-advancing an unanswered/expired question.

**P1 — should fix before production:**
- Restrict CORS to known origins (after P0 auth lands).
- Add rate limiting to auth and wallet endpoints.
- Add a production deployment path for `/api` and `/socket.io` (reverse proxy or same-process static serving) — the current setup only works in Vite dev mode.
- Add an environment-config layer (`.env`/`NODE_ENV`) actually used for CORS/data-path/log-level decisions.
- Add a React error boundary.
- Add session/room resumption after refresh or reconnect during a live match.
- Move off a single synchronous JSON file toward atomic writes at minimum, a real database before real stakes are ever involved.

**P2 — important improvements:**
- Add real UPI/crypto provider integration (or clearly keep as a labeled demo indefinitely) — this is genuinely a distinct integration project, not a bug fix.
- Add pending/processing/reversed transaction states to the wallet model.
- Add request logging/observability and basic alerting.
- Add a CI pipeline running lint/typecheck/tests on every push.
- Fix the 24-character name truncation vs. login-lookup mismatch.
- Expand automated test coverage to the client (`useArena` reducer, component tests).
- Broaden responsive-design verification across real breakpoints.

**P3 — future enhancements:**
- Sound, music, haptics, particle effects.
- Streak and difficulty-scaling systems.
- Dedicated "Play Again" quick-rematch button.
- Per-transaction detail/receipt view.
- Notification system (push/email/SMS) for wallet events.
- Formal accessibility audit (keyboard-only playthrough, contrast checks).
