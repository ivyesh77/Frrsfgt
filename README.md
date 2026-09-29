# Memory Match

A premium, production-ready browser memory game built with **React 19 + TypeScript + Vite**.

> Study the target image. It disappears. Find its twin among four corners before the clock runs out.

## Gameplay

- **Classic session**: exactly 20 rounds per game.
- Each round: a target image appears center-stage → memorize → it hides → four
  corner options appear (exactly one matches) → you pick → instant feedback →
  next round.
- Difficulty ramps smoothly across the 20 rounds (memorize time, answer time,
  and distractor similarity all increase) — never through unfair randomness.
- Score = base 100 + speed bonus (0-100, faster = more) + streak bonus (10 ×
  streak) × a small per-tier multiplier. Wrong answers and timeouts score 0
  and reset your streak.
- Best score, best streak, games played, and settings persist locally via
  `localStorage` (with corruption-safe fallbacks — a broken save can never
  crash the game).

## Tech stack

- **React 19** + **TypeScript** (strict mode, `noUncheckedIndexedAccess`)
- **Vite 8** for dev/build tooling
- **Framer Motion** for all micro-interactions and transitions
- **Web Audio API** — every sound effect is synthesized procedurally
  (oscillators + envelopes), so there are zero external audio dependencies
  or licensing concerns
- Plain modern CSS (custom properties, `clamp()`, CSS Grid) — no CSS
  framework needed
- No backend. 100% client-side, fully playable offline once loaded.

## Architecture

```
src/
  app entry:        main.tsx, App.tsx
  types/            shared TypeScript types (GamePhase, Round, ScoreState, ...)
  data/
    imageRegistry.ts  asset metadata (id, category, accent, image src)
  assets/images/      generated image assets, organized by category
  audio/
    soundEngine.ts     procedurally synthesized sound effects (Web Audio API)
  game/
    engine/
      gameReducer.ts     the single authoritative game state machine
      roundGenerator.ts  builds a validated, randomized round
      difficulty.ts      maps round number -> difficulty tuning
      scoring.ts         deterministic scoring + result aggregation
      validators.ts      runtime guards on every generated round
      constants.ts       all timing/scoring tunables in one place
    hooks/
      useGameEngine.ts   wires the reducer to timers, audio, haptics, storage
      useSettings.ts     persisted settings <-> sound engine
      useStats.ts        persisted best score/streak/games played
  components/
    common/    Button, ImageTile, ProgressRing, ParticleBurst, BackgroundFX, ...
    menu/      MainMenu
    game/      GameScreen, Hud, GameArena, CenterStage, AnswerCard, CountdownOverlay
    result/    ResultScreen
    settings/  SettingsModal
  utils/       storage.ts (safe localStorage), rng.ts, preload.ts, haptics.ts
```

The game logic is a single reducer-driven state machine (`GamePhase`): `MENU →
ROUND_INITIALIZING → TARGET_REVEAL → MEMORIZING → TARGET_HIDDEN → ANSWERING →
ANSWER_SELECTED → FEEDBACK_CORRECT/WRONG/TIMEOUT → NEXT_ROUND → ... →
GAME_COMPLETE`, with a `PAUSED` state for tab-visibility handling. All timing
is timestamp-based (`performance.now()`), not `setInterval` counters, so the
countdown can never drift, double-fire, or desync after a tab switch.

## Running locally

```bash
npm install
npm run dev
```

Then open the printed local URL (defaults to `http://localhost:5173`).

## Production build

```bash
npm run build   # type-checks with tsc -b, then builds with vite
npm run preview # serve the production build locally
```

## Automated checks

Because this sandbox has no headless-browser support, the core game logic
(round generation fairness, scoring math, the full state machine, double-input
protection, pause/resume timing) is covered by a standalone logic test:

```bash
npx tsx scripts/engine-selftest.ts
```

This simulates full 20-round sessions (mixing correct/wrong/timeout outcomes),
asserts every round validates, confirms scores/streaks/accuracy match the
scoring formula exactly, and confirms tab-visibility pause/resume never loses
or fabricates time.

## Known limitations (v1)

- The image set currently ships with **10 hand-picked, AI-generated assets**
  across the *animals* and *food/fruit* categories (image generation is
  rate-limited per turn in this environment). The round generator, difficulty
  system, and anti-repetition logic are all built to scale to a much larger
  registry — adding more images to `src/data/imageRegistry.ts` (vegetables,
  objects, vehicles, nature, household, toys, sports, symbols) is a pure data
  change with no engine changes required, and is planned as a follow-up.
- No backend/leaderboard by design (v1 is intentionally client-only, per spec).
