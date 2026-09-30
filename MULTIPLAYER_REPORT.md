# Wager Arena — Server-Authoritative Multiplayer Conversion Report

This is the final report for the task of converting the existing single-flow memory-match
game into a fully server-authoritative multiplayer system (1v1 duel and 1v1v1v1 squad), with
real server-side matchmaking, a server-owned match clock, server-generated questions, and a
polished, honestly-sourced matchmaking/result UI. It follows the same reporting standard as
`AUDIT_REPORT.md` and `SECURITY_FIX_REPORT.md`: concrete before/after claims, tests actually
run against the actual running server, and an explicit, non-euphemistic statement of what
still cannot be guaranteed.

**Nothing in this system is described as "unhackable."** See §7.

---

## 1. Summary of what changed and why

The previous implementation already had *some* server logic, but several trust boundaries
were still soft (client-influenced room selection, ambiguous lifecycle states, a
per-question stall model that didn't match the "one continuous match timer" requirement, and
a client UI that assumed it could render whatever the server happened to send without a
disciplined state machine). This pass:

- Replaced ad-hoc room states with an explicit, enforced lifecycle:
  `queued → ready_check → starting → active → finished` (+ `cancelled`), implemented as a
  real state machine on the server (`server/src/rooms.ts`) — illegal transitions (e.g.
  answering a `finished` match, readying a `finished` match, joining by room id) are
  rejected server-side regardless of what the client sends.
- Replaced any notion of a client-chosen room/opponent with **real queues** keyed by
  `(gameKind, entryFee, format)`. `queue:join` never accepts or honors a client-supplied
  room id — the server alone decides placement, confirmed live in §6.
- Made the match clock single, overall, and server-owned: `matchStartedAt` /
  `matchEndsAt` are stamped once when a room enters `active` and are the only clock any
  scoring/timeout decision is made against. There is no more "per-question stall."
- Rewrote scoring so correct = +1, wrong = −1, immediate reveal, immediate next round, no
  elimination, continuous play until the shared timer hits zero, then the server alone
  finalizes and no further answers are accepted.
- Rewrote the payout/result computation (`server/src/payout.ts`) so duels can end in a real,
  refunded **draw** (equal top score) instead of an arbitrary tiebreak, and squads always
  produce a full server-computed 1st–4th ranking.
- Rewrote the entire client protocol layer (`src/arena/types.ts`, `src/arena/useArena.ts`) to
  match the new wire shapes, and rewrote the matchmaking/room/result UI
  (`Matchmaking.tsx` [new], `RoomScreen.tsx`, `QuestionRenderer.tsx`, `MatchResult.tsx`,
  `Lobby.tsx`) so every visible player, score, and countdown is either literally the value
  the server just broadcast, or a display-only cosmetic tween between two server-anchored
  timestamps.
- The core gameplay concept — a center target and four corner options — is untouched. Only
  the matchmaking, lifecycle, scoring, and timing model around it changed, per the guardrail.
- Wallet/payment mechanics were **not** touched beyond what the new draw/void-match refund
  path required in `payout.ts`; auth, session, and Task 10's hardening were not modified.

## 2. Files changed

**Server**
- `server/src/types.ts` — new wire types: `RoomStatus`, `PlayerConnectionState`,
  `RoomPlayerPublic` (opaque per-recipient fields only), `RoomStatePublic`
  (`readyDeadline`, `startsAt`), `MatchResultPublic` (`isDraw`, `endedBy`),
  `RoundTimeoutPublic` (`score`), `RoundResultPublic`.
- `server/src/rooms.ts` — the actual state machine: queueing, ready-check with a deadline,
  starting countdown, active-match question sequencing, per-round token issuance, answer
  validation, disconnect/reconnect/forfeit handling, match finalization, rematch handling,
  and room/timer cleanup on completion.
- `server/src/payout.ts` — duel WIN/LOSE/DRAW determination, squad 1st–4th ranking, pool
  math for the 80/20 split and full-refund-on-draw/void paths.
- `server/src/index.ts` — Socket.IO handlers: `queue:join`, `queue:leave`, `rooms:leave`,
  `rooms:ready`, `match:answer`, `match:rematch`, `disconnect`, each authenticating the
  caller from the session (never from payload fields) and each independently rate-limited.
- `server/src/selftest.ts` — expanded in-process test suite (see §5) covering the queue,
  ready-check, scoring, draw, squad ranking, wallet-exactness, and identity-leak invariants.
- `server/src/{auth,wallet,store,rateLimit}.ts`, `gameKinds/*`, `express.d.ts` — **not
  modified**; confirmed by inspection this task didn't need to touch them.

**Client**
- `src/arena/types.ts` — mirrors the new server wire types exactly.
- `src/arena/useArena.ts` — rewritten hook: `joinQueue` / `leaveRoom` / `setReady` /
  `submitAnswer` / `requestRematch` / `backToLobby` / `logout` / `clearError` /
  `dismissNotice`, plus `state` (room, match, notice, `matchFoundToken`). No client-side
  score, winner, or timer computation lives here — it stores exactly what the server sends.
- `src/arena/components/Matchmaking.tsx` — **new**. Searching animation with a live
  server-reported slot count, match-found reveal with real player cards, ready badges, a
  ready-deadline countdown, and a server-driven 3-2-1-GO countdown keyed off `room.startsAt`.
- `src/arena/components/RoomScreen.tsx` — rewritten to delegate to `Matchmaking` for every
  non-`active` room status, and for `active` renders the question area plus a leaderboard
  sourced solely from `room.players` broadcasts.
- `src/arena/components/QuestionRenderer.tsx` — rewritten with framer-motion entrance/shake/
  glow animations and an animated +1/−1 feedback popup; the underlying protocol (opaque
  `option.token`, server-only correctness) is unchanged.
- `src/arena/components/MatchResult.tsx` — rewritten: distinct animated headlines for duel
  win/lose/draw and squad final standings, a ranked result list with avatars/medals/payout,
  pool-breakdown (including refund messaging for draws/void matches), and Rematch /
  Return-to-Lobby actions that call the server (`requestRematch`), never a client-only replay.
- `src/arena/components/Lobby.tsx` — corrected a stale `'waiting'` status check to the new
  `'queued'` status name; the "open tables" list is explicitly commented as
  cosmetic/informational only — it never determines actual matchmaking placement.
- `src/arena/components/ArenaApp.tsx` — wired the new props (`matchFoundToken`, `busy`,
  `onRematch`) through to the rewritten child components.
- `src/arena/components/arena.css` — new styles for matchmaking, avatars, ready badges,
  search-pulse/GO-countdown animations, answer feedback, and result-headline variants.
- `src/arena/components/{Home,AuthModal,WalletModal,ProfileScreen}.tsx` — **not modified**;
  confirmed by grep that none of them import any of the changed room/match types, so they
  were correctly left untouched.
- `security-retest.mjs` — extended with a new Task 11-specific exploit block (§6).

## 3. Matchmaking / lifecycle model

```
IDLE → (queue:join) → QUEUED → (queue fills) → READY_CHECK → (all ready) → STARTING
   → (countdown elapses) → ACTIVE → (shared timer hits 0, or all-but-one forfeit) → FINISHED
```
`CANCELLED` is reachable from `QUEUED` (leave) and `READY_CHECK` (ready-deadline miss →
requeue-or-cancel, never silently stuck). Every transition is driven by server state; the
client only ever *requests* (`queue:join`, `rooms:ready`, `rooms:leave`) and *renders* the
resulting broadcast. There is no client message that can move a room state backwards or skip
a step (verified live in §6, item 14).

## 4. Protocol / anti-cheat model

- Every socket is authenticated from the session cookie at connection time
  (`socket.data.userId`); no handler ever trusts a `userId`/`profile`/`score` field supplied
  in a payload — confirmed live in §6, items 12–13.
- Questions are generated entirely server-side: target, four options, and the correct
  answer are chosen by the server, and the client only ever receives opaque per-round
  (`roundId`) and per-option (`token`) identifiers — never an index or a correctness flag.
- `match:answer` accepts only `{ roomId, roundId, optionToken }`. Any extra fields
  (`score`, `correct`, `setScoreTo`, `targetUserId`, …) are ignored; the ack always reflects
  the server's own authoritative recomputation, never an echo of client input.
- Each round's token is invalidated the instant it resolves (first valid answer, or
  timeout) — replaying an old `roundId` is rejected with `Stale or unknown round` (§6.8b).
- All answers are checked against server wall-clock time; the single match timer
  (`matchStartedAt`/`matchEndsAt`) is the only clock consulted, and once it elapses the
  server itself finalizes the match and stops accepting `match:answer` regardless of what a
  client still sends.
- Rate limiting (in-memory sliding window keyed by authenticated user id, not by
  socket/IP) guards `queue:join` (10/min), `queue:leave`/`rooms:leave` (20/min),
  `rooms:ready` (10/10s), `match:answer` (60/10s), and `match:rematch` (10/min) — this is
  enforced independently of anything the frontend does, per the standing constraint that
  frontend throttling is never a control.
- Only gameplay-necessary fields are ever broadcast per player (opaque id, display name,
  avatar, score, ready flag, connection state) — never the internal DB id, wallet id, email,
  or auth data. This was spot-checked live in §6.6 (no account-id leak to a room-mate) and by
  reading the `RoomPlayerPublic`/`toPublicPlayer` projection in `rooms.ts`.
- Disconnect handling: a disconnected player's seat is marked `disconnected`; if they do not
  reconnect and re-authenticate before the match ends they are marked `forfeited` (no further
  score changes, but they don't disappear from the standings); a reconnecting socket is
  re-validated against the session exactly like a fresh connection — nothing about "who this
  socket claims to be" is ever taken on trust.

## 5. Tests performed

**In-process self-test suite** (`node --import tsx server/src/selftest.ts`, re-run after
every change): all pass. Latest run covers, among other things:
own-stats/wallet-auth checks, queue-join wallet debits and refunds, joining above balance,
double-queueing rejection, full 4-player squad matchmaking through
`queued → ready_check → starting → active`, pool/payout arithmetic (`pool == sum(entry
fees)`, `platform cut + winner payout == pool` exactly), a scripted "always correct" player
winning a squad match, a scripted "always wrong" player finishing with a **negative** score
and receiving **no** payout (no floor-at-zero elimination), no account-id leak in the
`match:end` payload, duel win/pool/wallet-exactness, and a scripted tie producing a genuine
duel **draw with a full refund to both players** (not an arbitrary tiebreak).

**Build/type/lint verification**: `npx tsc -b --force` — clean, zero errors, across both the
server and client TypeScript projects. `npx vite build` — succeeds (435.62 kB JS / 28.24 kB
CSS bundle). `npx oxlint` — zero new warnings versus the pre-existing baseline.

**Live end-to-end smoke test** (ad hoc Node script, two real signed-up accounts, real
Socket.IO connections through the actual Vite dev-server proxy into the actual backend,
not the self-test harness): signup → connect → `queue:join` → real `match:found` for both
players → both `rooms:ready` → server-driven `starting` countdown → `active` with a real
target/options reveal → two real `match:answer` submissions, with the server's authoritative
`correct`/`score` read back from the ack (`-1` after a wrong answer, `0` after a correct one
recovered it) → clean `rooms:leave`/disconnect. Passed end-to-end.

## 6. Live security re-test (external attacker's-eye view)

Run with `node security-retest.mjs http://localhost:8787` against the actual running dev
backend, from a separate process with no special access — exactly like an attacker's own
script. This extends the Task 10 re-test file with new Task 11-specific probes. Final tally:
**15 exploit attempts blocked, 0 still possible**, latest full run:

1. ✅ Account takeover via name-only login (no password check) — `401`.
2. ✅ IDOR: attacker tries to drain the victim's wallet via a forged `userId` field — victim
   balance unchanged.
3. ✅ Reading anyone's wallet with zero authentication — `401`.
4. ✅ Forged/garbage session cookie — `401`.
5. ✅ Unauthenticated Socket.IO connection — rejected at handshake.
6. ✅ Room broadcast leaking another player's real account id to a room-mate — the id shown
   to the attacker is not the victim's real id.
7. ✅ **(new)** Acting on a forged/nonexistent match id (`match:answer` against a room id
   that doesn't exist) — rejected, `"Match is not live"`.
8. ✅ **(new)** Answering a stale/never-issued round id from a genuine member of the room —
   rejected, `"Stale or unknown round"`.
9. ✅ **(new)** Answering a match the caller never joined, from a third authenticated
   account seated nowhere near that room — rejected, `"Player not in an active match"`.
10. ✅ **(new)** Smuggling a client-chosen `roomId` field into `queue:join` to try to land in
    someone else's match — the server placed the caller into its own independently-chosen
    room regardless of the forged field; `queue:join` never reads a client-supplied room id
    at all.
11. ✅ **(new)** Forging another player's identity/score via extra fields
    (`targetUserId`/`setScoreTo`) on `match:answer` — the server only ever mutates the
    caller's own session-authenticated seat; there is no field that can address another
    player's score.
12. ✅ Unlimited-throughput answer spam (the original P0 finding) — thousands of rapid-fire
    `match:answer` calls in a 3-second window; **zero to one** ever accepted, the rest
    rejected by real round/timing validation and/or the per-user rate limiter.
13. ✅ Client-declared score/correctness payload (`score: 999999, correct: true`) sent
    directly — rejected outright; the ack never echoes client-supplied correctness.
14. ✅ **(new)** Forging a wallet/profile mutation against another account via extra body
    fields (`userId`/`targetUserId` on `/api/wallet/topup`) — the write only ever lands on
    the caller's own account; the victim's balance was verified unchanged immediately before
    and after the attempt.
15. ✅ **(new)** Attempting to force early match completion by emitting plausible
    "end-the-match" event names (`match:end`, `match:forceComplete`, `match:finish`,
    `rooms:end`, `match:setResult`) directly at the socket — none of these are registered
    server handlers (confirmed against the exact `socket.on()` list in `index.ts`:
    `queue:join`, `queue:leave`, `rooms:leave`, `rooms:ready`, `match:answer`,
    `match:rematch`, `disconnect`), so Socket.IO silently drops them with no ack and no
    effect; only the server's own timer/forfeit logic can ever end a match.

## 7. Honest statement of remaining limitations — this is **not** "unhackable"

Per the standing rule carried over from Task 10, nothing here should be read as a claim that
the system cannot be compromised. What is true, and what is not yet proven, as of this pass:

- **What is true**: every value tested above (identity, room membership, round tokens,
  score, timer, match completion) is derived only from server-verified state; the specific
  forgery/IDOR/timing/race attempts above were all rejected live against the real running
  server, not just in a unit test. The in-memory rate limiter and round-token invalidation
  meaningfully raise the cost of automation compared to the pre-fix baseline documented in
  `AUDIT_REPORT.md`.
- **What was not exercised and remains a real gap**: the store is a single in-memory/JSON
  process with no clustering, no persistent audit log of every rejected action, and no
  distributed rate-limit store — a restart clears rate-limit counters, and a multi-process
  deployment would need a shared limiter (e.g. Redis) to hold under this task's guarantees.
  There is no TLS/transport-layer testing here (this was exercised over plain
  `http://localhost`); in a real deployment, session-cookie security depends on `Secure`/
  `SameSite` flags and HTTPS being correctly configured at the edge, which is outside this
  task's scope to verify.
- **Timing races not exhaustively proven**: "simultaneous answers from both players in the
  same millisecond" and "answer arriving exactly at the timeout boundary" were exercised via
  rapid sequential calls and via the self-test suite's scripted scenarios, not via a true
  multi-process concurrent-request harness; the code path is a single-threaded Node event
  loop processing one socket event at a time, which structurally rules out a true data race
  on score mutation, but this claim rests on the Node concurrency model rather than an
  independently reproduced timing experiment.
- **Reconnect-during-active-question** was implemented (disconnected → forfeited handling)
  and covered by the self-test suite's connection-state invariants, but was not re-verified
  in this pass via a live socket disconnect/reconnect against the running dev server in the
  external security re-test script — that would be a reasonable next hardening step before a
  production launch.
- As with Task 10: no client-side control (disabled buttons, hidden fields, obfuscated JS,
  localStorage, or a client-only timer) is relied upon anywhere in this system for security,
  by design — but that is a design property being reported, not an empirical guarantee that
  covers every conceivable future code path someone might add later without re-reading this
  document.

## 8. Readiness verdict

The multiplayer conversion meets the stated acceptance criteria: server-authoritative
matchmaking/lifecycle/scoring/timer/question-generation, opaque tokens, per-recipient
sanitized broadcasts, rate-limited actions, a real draw path for duels and a real ranked
squad result, and a client that renders rather than decides. All automated tests and the
live external-style re-test pass as of this commit. Recommended before a real-money
production launch: a shared (non-in-memory) rate limiter, a proper reverse-proxy TLS
configuration with `Secure`/`SameSite=strict` cookies, and a dedicated concurrent-request
load test for the exact-timeout race case described in §7.
