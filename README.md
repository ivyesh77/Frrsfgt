# Memory Match — Classic + Wager Arena

A **React 19 + TypeScript** game with two modes:

1. **Classic** — a polished, 100% client-side single-player memory game (the
   original build). No backend required.
2. **Wager Arena** — a real-time **multiplayer** platform: players join
   stake-based rooms (virtual currency, ₹10–₹10,000-equivalent tiers), race a
   shared 60-second clock across **10 different quick-reflex game modes**,
   and the winner takes **80% of the pool** (the platform keeps 20%). Backed
   by a real Node/Express/Socket.IO server — not a local simulation.

> Real money is **not** processed anywhere in this build. The Arena uses a
> virtual wallet only, seeded with a starting balance and top-up-able for
> free. The server-side wallet/ledger is intentionally structured so a real
> payment gateway (and KYC/withdrawal flow) could be plugged in behind the
> same `wallet.ts` module later, without touching any game logic.

## Quick start

```bash
npm install               # frontend deps
npm run server:install    # backend deps (separate package.json under server/)

npm run server:dev        # terminal 1 — arcade backend on :8787
npm run dev                # terminal 2 — frontend on :5173 (proxies /api and /socket.io to :8787)
```

Open `http://localhost:5173`. The menu offers **PLAY** (Classic) and
**🪙 Wager Arena** (multiplayer).

## Verification

```bash
npm run test        # Classic engine regression self-test (scripts/engine-selftest.ts)
npm run server:test # Arena backend self-test: wallet math, pooling, live match, exact 80/20 payout
npx tsc -b --noEmit  # frontend type-check
npx oxlint           # frontend lint
npm run build        # production build
```

The server self-test spins up the real Express + Socket.IO server in-process
(short-circuited match/countdown durations via env vars, never in
production), drives multiple concurrent virtual players through guest login →
room join → entry-fee debit → live scoring → payout, and asserts the wallet
and pool math to the rupee. There is no browser available in this sandbox, so
this Node-level simulation plus manual code review is the verification
strategy for the multiplayer flow.

## Classic mode

- Exactly 20 rounds per game. Each round: a target image appears center-stage
  → memorize → it hides → four corner options appear (exactly one matches) →
  you pick → instant feedback → next round.
- Difficulty ramps smoothly across the 20 rounds (memorize time, answer time,
  distractor similarity) — never through unfair randomness.
- Score = base 100 + speed bonus (0-100) + streak bonus (10 × streak) × a
  small per-tier multiplier. Wrong answers/timeouts score 0 and reset streak.
- Best score, best streak, games played, and settings persist locally via
  `localStorage` (corruption-safe fallbacks).
- 100% client-side. Fully playable offline once loaded. No backend needed.

## Wager Arena mode

### Flow

1. **Guest login** — enter a display name, get a server-issued id + a 1000
   virtual-coin starting wallet (persisted to disk on the server, and
   remembered in the browser via `localStorage` so refreshing keeps you
   logged in).
2. **Lobby** — pick one of 10 game kinds, pick an entry-fee tier (10 → 10,000
   coins), and either create a room or join an existing open one. The lobby
   polls the room list every few seconds.
3. **Waiting room** — players tap "Ready"; once everyone is ready (min. 2
   players) a short countdown starts the match.
4. **Live match (60s)** — each player gets their **own independently-paced**
   stream of questions (not lockstep with other players): correct answer =
   +1 point instantly reflected on everyone's live leaderboard; wrong answer
   = -1 of 5 starting "chances" (hit 0 chances and you stop getting new
   questions, but the clock keeps running for everyone else).
5. **Result** — highest score wins (ties broken by fewer wrong answers, then
   earliest final answer; a remaining tie splits the payout evenly). Winner
   payout = `round(pool × 0.8)`; the platform keeps the exact remainder
   (`pool - winnerPayout`), so the two numbers always reconstruct the pool
   exactly with zero rounding leak.

### The 10 game kinds

All ten share one generic question shape
(`{ memorizeMs, answerMs, prompt, options[4] }`) so a single client renderer
and a single server-side validator can host every kind. Only **Memory
Match** needs real image assets (it reuses the 10 AI-generated icons under
`src/assets/images/`); the other nine are fully procedural (numbers, text,
emoji, CSS shapes, colors) and need no image assets.

| Kind | What you do |
| --- | --- |
| Memory Match | Memorize an icon, then spot its twin among four. |
| Quick Math | Solve a small arithmetic expression before time runs out. |
| Color Match | Memorize a color swatch, pick it from four. |
| Emoji Match | Memorize an emoji, pick it from four. |
| Odd One Out | Spot the one tile that differs from the other three. |
| Number Sequence | Work out the next number in a short sequence. |
| Word Scramble | Unscramble jumbled letters into the real word. |
| Shape Match | Memorize a shape, pick it from four. |
| Pattern Recall | Memorize a short symbol sequence, pick the matching one. |
| Reaction Tap | Wait for an unpredictable delay, tap the tile that lights up first. |

### Fairness / anti-cheat model

The server is **authoritative** for every question and every answer — it
generates all four options and keeps the correct index private, validates
every submitted answer, and owns the entire wallet ledger (debits, refunds,
payouts, platform fees). A client can never forge points or balances. The one
intentionally-scoped exception: because "options" are shown to the player in
full up front for gameplay purposes, the payload itself is not further
obfuscated beyond that — this is an accepted trade-off for the virtual-
currency practice phase and is easy to harden further (e.g. reveal-gating
more kinds the way `reactionTap` already does) before real money is ever
involved.

## Tech stack

- **React 19** + **TypeScript** (strict mode, `noUncheckedIndexedAccess`) on
  the frontend, **Node 22 + TypeScript + Express + Socket.IO** on the backend
  (separate `server/` package, own `tsconfig.json`).
- **Vite 8** dev/build tooling; the dev server proxies `/api` and
  `/socket.io` to the backend so the browser only ever talks to one origin.
- **Framer Motion** for micro-interactions/transitions.
- **Web Audio API** — Classic mode's sound effects are synthesized
  procedurally (oscillators + envelopes); zero external audio dependencies.
- **socket.io-client** on the frontend for the Arena's live multiplayer sync.
- Plain modern CSS (custom properties, `clamp()`, CSS Grid) — no CSS
  framework.
- JSON-file persistence for the wallet/ledger (`server/data/store.json`,
  git-ignored, regenerated on first run) — intentionally simple for this
  phase; rooms/matches themselves are in-memory/ephemeral.

## Architecture

```
src/
  app entry:        main.tsx, App.tsx           (mode switch: Classic vs Arena)
  types/            Classic-mode shared types
  data/
    imageRegistry.ts  10 AI-generated local image assets, registered here
  utils/            rng, storage, haptics, preload helpers
  audio/            procedural Web Audio sound engine (Classic mode)
  game/
    engine/         Classic mode's pure state machine (constants, difficulty,
                     validators, round generator, scoring, reducer)
    hooks/          useGameEngine, useSettings, useStats
  components/       Classic mode UI (menu, game, result, settings, common)
  arena/            Wager Arena frontend module
    types.ts          mirrors the backend's wire types (kept in sync by hand)
    api.ts            REST helpers (guest login, wallet)
    socket.ts         shared Socket.IO client connection
    storage.ts        persists the guest identity across reloads
    useArena.ts        central reducer/hook: the Arena's single state machine
    useNow.ts          timestamp-based ticking clock (never a bare counter)
    components/        GuestLogin, Lobby, RoomScreen, QuestionRenderer,
                        MatchResult, ArenaApp (orchestrator) + arena.css

server/
  src/
    types.ts          shared domain types + tunables (entry fees, durations)
    store.ts           JSON-file persistence for users + transaction ledger
    wallet.ts           debit/credit/topup/payout, all ledger-recorded
    gameKinds/          one generator per game kind + the registry (index.ts)
    rooms.ts            room lifecycle: create/join/leave/ready/live/payout
    index.ts            Express REST + Socket.IO event wiring
    selftest.ts         end-to-end self-test (see Verification above)
```

## Known limitations

- Only 10 of the originally-envisioned larger Classic-mode image pool exist
  (per-turn image-generation caps in this environment) — Memory Match (both
  Classic and the Arena kind) is fully playable with these 10, just with a
  smaller variety than a larger content set would offer.
- No browser is available in this sandbox, so the Arena UI has been verified
  via `tsc`/`oxlint`/production build plus a Node-driven Socket.IO client
  that exercises the exact same HTTP/WebSocket paths a browser would (through
  the Vite proxy) — not via manual clicking in a real browser.
- Wallet/ledger persistence is a single JSON file — fine for a demo/dev
  deployment, not a concurrent-write-safe production database.
- No real payment gateway, KYC, or withdrawal flow — by design, deferred to a
  future phase per current scope.
