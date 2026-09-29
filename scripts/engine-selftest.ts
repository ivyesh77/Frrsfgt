/**
 * Logic-level self test for the game engine (round generation, scoring,
 * validation, reducer state machine) run outside the browser via tsx.
 * This sandbox has no working headless browser, so this script is the
 * primary automated regression check for the core gameplay logic.
 */
import type { AssetMetadata, RoundOutcome } from '../src/types';
import { generateRound, pushHistory } from '../src/game/engine/roundGenerator';
import { validateRound } from '../src/game/engine/validators';
import { getDifficultyForRound } from '../src/game/engine/difficulty';
import { computeRoundPoints, applyRoundResult, createInitialScoreState, buildGameResult } from '../src/game/engine/scoring';
import { gameReducer, createInitialEngineState } from '../src/game/engine/gameReducer';
import { TOTAL_ROUNDS } from '../src/game/engine/constants';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failures += 1;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`ok   ${msg}`);
  }
}

const CATEGORIES: AssetMetadata['category'][] = ['animals', 'food', 'fruits'];
const MOCK_ASSETS: AssetMetadata[] = Array.from({ length: 12 }, (_, i) => ({
  id: `asset-${i}`,
  category: CATEGORIES[i % CATEGORIES.length],
  name: `Asset ${i}`,
  tags: [],
  accent: ['#111111', '#222222'] as [string, string],
  src: `mock://asset-${i}.webp`,
}));

// ---------------------------------------------------------------------------
// 1. Round generation invariants across many rounds and difficulty tiers
// ---------------------------------------------------------------------------
let history: string[] = [];
const correctPositions: number[] = [];
for (let round = 1; round <= TOTAL_ROUNDS; round += 1) {
  const r = generateRound(round, MOCK_ASSETS, history);
  const err = validateRound(r);
  assert(err === null, `round ${round} validates (${err ?? 'ok'})`);
  assert(r.options.length === 4, `round ${round} has exactly 4 options`);
  assert(new Set(r.options.map((o) => o.asset.id)).size === 4, `round ${round} has unique option ids`);
  assert(r.options.filter((o) => o.isCorrect).length === 1, `round ${round} has exactly one correct option`);
  correctPositions.push(r.correctPosition);
  history = pushHistory(history, r.target.id);
}
const distinctPositions = new Set(correctPositions);
assert(distinctPositions.size > 1, `correct answer position varies across rounds (saw ${[...distinctPositions]})`);

// Difficulty should ramp: memorize/answer time should generally decrease.
const easy = getDifficultyForRound(1);
const final = getDifficultyForRound(20);
assert(final.memorizeMs < easy.memorizeMs, 'memorize time shrinks from round 1 to round 20');
assert(final.answerMs < easy.answerMs, 'answer time shrinks from round 1 to round 20');
assert(final.scoreMultiplier >= easy.scoreMultiplier, 'score multiplier does not decrease with round number');

// Immediate target repetition should be rare when the deck is large enough.
let immediateRepeats = 0;
let h: string[] = [];
let prevTarget: string | null = null;
for (let round = 1; round <= 50; round += 1) {
  const r = generateRound(round, MOCK_ASSETS, h);
  if (prevTarget === r.target.id) immediateRepeats += 1;
  prevTarget = r.target.id;
  h = pushHistory(h, r.target.id);
}
assert(immediateRepeats === 0, `no immediate target repeats across 50 rounds (found ${immediateRepeats})`);

// ---------------------------------------------------------------------------
// 2. Scoring determinism
// ---------------------------------------------------------------------------
const p1 = computeRoundPoints({ outcome: 'correct', responseMs: 0, answerMs: 5000, streakAfter: 1, scoreMultiplier: 1 });
assert(p1 === 100 + 100 + 10, `instant correct answer on streak 1 scores 210 (got ${p1})`);

const p2 = computeRoundPoints({ outcome: 'correct', responseMs: 5000, answerMs: 5000, streakAfter: 1, scoreMultiplier: 1 });
assert(p2 === 100 + 0 + 10, `answer at the wire scores base+streak only (got ${p2})`);

const p3 = computeRoundPoints({ outcome: 'wrong', responseMs: 500, answerMs: 5000, streakAfter: 0, scoreMultiplier: 1 });
assert(p3 === 0, `wrong answer scores 0 (got ${p3})`);

const p4 = computeRoundPoints({ outcome: 'timeout', responseMs: null, answerMs: 5000, streakAfter: 0, scoreMultiplier: 1 });
assert(p4 === 0, `timeout scores 0 (got ${p4})`);

let score = createInitialScoreState();
score = applyRoundResult(score, 'correct', 800, 150);
score = applyRoundResult(score, 'correct', 600, 160);
score = applyRoundResult(score, 'wrong', null, 0);
score = applyRoundResult(score, 'correct', 400, 170);
assert(score.correct === 3, `score state tracks 3 correct (got ${score.correct})`);
assert(score.wrong === 1, `score state tracks 1 wrong (got ${score.wrong})`);
assert(score.streak === 1, `streak resets after a wrong answer then increments (got ${score.streak})`);
assert(score.bestStreak === 2, `best streak captured mid-session (got ${score.bestStreak})`);
assert(score.score === 150 + 160 + 170, `cumulative score sums correctly (got ${score.score})`);

const result = buildGameResult(score, 12000, 100, 1);
assert(result.accuracy === 3 / 4, `accuracy = correct / totalRounds (got ${result.accuracy})`);
assert(result.isNewBestScore === true, 'new best score detected when score exceeds previous best');
assert(result.averageResponseMs === (800 + 600 + 400) / 3, 'average response time computed only from answered rounds');
assert(result.fastestResponseMs === 400, 'fastest response time is the minimum recorded');

// ---------------------------------------------------------------------------
// 3. Reducer state machine: no double scoring, answer lock, full 20-round flow
// ---------------------------------------------------------------------------
function simulateOneRound(state: ReturnType<typeof createInitialEngineState>, outcome: RoundOutcome) {
  let s = state;
  const assets = MOCK_ASSETS;
  const now = () => performance.now();

  s = gameReducer(s, { type: 'ADVANCE', now: now(), assets }); // TARGET_REVEAL -> MEMORIZING
  s = gameReducer(s, { type: 'ADVANCE', now: now(), assets }); // MEMORIZING -> TARGET_HIDDEN
  s = gameReducer(s, { type: 'ADVANCE', now: now(), assets }); // TARGET_HIDDEN -> ANSWERING

  if (outcome === 'timeout') {
    s = gameReducer(s, { type: 'ANSWER_TIMEOUT', now: now() });
  } else {
    const round = s.round!;
    const position = outcome === 'correct' ? round.correctPosition : round.options.findIndex((o) => !o.isCorrect);
    s = gameReducer(s, { type: 'SELECT_ANSWER', position, responseMs: 500, now: now() });
    // Double-click / duplicate input must be ignored once locked.
    const beforeScore = s.score.score;
    s = gameReducer(s, { type: 'SELECT_ANSWER', position, responseMs: 10, now: now() });
    assert(s.score.score === beforeScore, `round ${s.roundNumber}: duplicate SELECT_ANSWER does not re-score`);
  }

  s = gameReducer(s, { type: 'ADVANCE', now: now(), assets }); // ANSWER_SELECTED -> FEEDBACK_*
  s = gameReducer(s, { type: 'ADVANCE', now: now(), assets }); // FEEDBACK_* -> NEXT_ROUND
  s = gameReducer(s, { type: 'ADVANCE', now: now(), assets }); // NEXT_ROUND -> next TARGET_REVEAL or GAME_COMPLETE
  return s;
}

let engineState = createInitialEngineState();
engineState = gameReducer(engineState, { type: 'START_GAME', now: performance.now(), assets: MOCK_ASSETS });
assert(engineState.phase === 'TARGET_REVEAL', 'START_GAME enters TARGET_REVEAL');
assert(engineState.roundNumber === 1, 'START_GAME begins at round 1');

const outcomes: RoundOutcome[] = [];
for (let i = 0; i < TOTAL_ROUNDS; i += 1) {
  const outcome: RoundOutcome = i % 5 === 4 ? 'timeout' : i % 3 === 0 ? 'wrong' : 'correct';
  outcomes.push(outcome);
  engineState = simulateOneRound(engineState, outcome);
}

assert(engineState.phase === 'GAME_COMPLETE', `game reaches GAME_COMPLETE after ${TOTAL_ROUNDS} rounds (phase=${engineState.phase})`);
const expectedCorrect = outcomes.filter((o) => o === 'correct').length;
const expectedWrong = outcomes.filter((o) => o === 'wrong').length;
const expectedTimeout = outcomes.filter((o) => o === 'timeout').length;
assert(engineState.score.correct === expectedCorrect, `final correct count matches simulation (${engineState.score.correct}/${expectedCorrect})`);
assert(engineState.score.wrong === expectedWrong, `final wrong count matches simulation (${engineState.score.wrong}/${expectedWrong})`);
assert(engineState.score.timeouts === expectedTimeout, `final timeout count matches simulation (${engineState.score.timeouts}/${expectedTimeout})`);
assert(
  engineState.score.correct + engineState.score.wrong + engineState.score.timeouts === TOTAL_ROUNDS,
  'correct + wrong + timeouts always equals total rounds played',
);

// Selecting an answer while not in ANSWERING (e.g. menu / feedback) must be a no-op.
const menuState = createInitialEngineState();
const afterIllegalSelect = gameReducer(menuState, { type: 'SELECT_ANSWER', position: 0, responseMs: 10, now: performance.now() });
assert(afterIllegalSelect === menuState, 'SELECT_ANSWER is ignored outside of ANSWERING (illegal transition guard)');

// Visibility pause/resume should not lose or fabricate time.
let pausable = createInitialEngineState();
pausable = gameReducer(pausable, { type: 'START_GAME', now: 1000, assets: MOCK_ASSETS });
pausable = { ...pausable, phaseStartedAt: 1000, phaseDuration: 2000 };
pausable = gameReducer(pausable, { type: 'VISIBILITY_HIDDEN', now: 1500 });
assert(pausable.phase === 'PAUSED', 'tab hidden pauses an active timed phase');
assert(pausable.pausedRemaining === 1500, `remaining time captured correctly on pause (got ${pausable.pausedRemaining})`);
pausable = gameReducer(pausable, { type: 'VISIBILITY_VISIBLE', now: 9000 });
assert(pausable.phase === 'TARGET_REVEAL', 'resumes into the phase that was interrupted');
assert(pausable.phaseDuration === 1500, 'resumed phase keeps the previously remaining duration, not a fresh one');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
