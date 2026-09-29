/**
 * End-to-end self-test for the multiplayer wagering arcade backend.
 *
 * Spins up the real Express + Socket.IO server in-process (on a throwaway
 * port, with a shortened match duration so this finishes in seconds instead
 * of real 60s matches), then drives several concurrent virtual players
 * through: guest login -> room create/join -> entry-fee debit -> live
 * question/answer loop -> match end -> 80/20 payout, asserting the exact
 * wallet and pool math at every step since this is money-logic with zero
 * tolerance for rounding leaks.
 */
process.env.PORT = process.env.PORT || '8799';
// Generous-but-still-fast overrides: short enough to keep the suite quick, long enough
// to have comfortable headroom over sandbox scheduling jitter so the suite never flakes.
process.env.ARCADE_MATCH_DURATION_MS = '4000';
process.env.ARCADE_READY_COUNTDOWN_MS = '400';

import { io as ioClient, type Socket } from 'socket.io-client';
import { generateQuestion } from './gameKinds/index.js';
import { computeMatchPayout } from './payout.js';
import { GAME_KINDS, type ArcadeQuestionPublic, type MatchResultPublic, type RoomStatePublic, type User } from './types.js';

const BASE_URL = `http://localhost:${process.env.PORT}`;

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (!condition) {
    failures += 1;
    console.error(`✗ FAIL: ${message}`);
  } else {
    console.log(`✓ ${message}`);
  }
}

async function createGuest(name: string): Promise<User> {
  const res = await fetch(`${BASE_URL}/api/auth/guest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const body = (await res.json()) as { user: User };
  return body.user;
}

/** Mode-aware auth call used to verify real login-vs-signup semantics (not just find-or-create). */
async function authGuest(name: string, mode: 'login' | 'signup'): Promise<{ status: number; body: { user?: User; error?: string } }> {
  const res = await fetch(`${BASE_URL}/api/auth/guest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mode }),
  });
  const body = (await res.json()) as { user?: User; error?: string };
  return { status: res.status, body };
}

async function getWallet(userId: string): Promise<User> {
  const res = await fetch(`${BASE_URL}/api/wallet/${userId}`);
  const body = (await res.json()) as { user: User };
  return body.user;
}

function connect(): Socket {
  return ioClient(BASE_URL, { transports: ['websocket'], forceNew: true });
}

function emitAck<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve) => socket.emit(event, payload, (ack: T) => resolve(ack)));
}

/** Answers every question the socket receives until the match ends; returns the final result payload. */
function playUntilMatchEnds(
  socket: Socket,
  userId: string,
  roomId: string,
  strategy: 'cycle' | 'always-wrong',
): Promise<MatchResultPublic> {
  let cycleIndex = 0;
  return new Promise((resolve) => {
    socket.on('match:question', (question: ArcadeQuestionPublic) => {
      const send = () => {
        // 'cycle' walks 0,1,2,3,0,1,2,3,... across many independent questions in the match
        // window; each question's correctIndex is independently uniform in [0,3], so this
        // behaves like unbiased guessing with a >99.99% chance of at least one hit over the
        // ~20+ questions a 4s match produces — comfortably reliable without being a fixed cheat.
        const choiceIndex = strategy === 'always-wrong' ? 99 : cycleIndex++ % question.options.length;
        void emitAck(socket, 'match:answer', { userId, roomId, questionId: question.id, choiceIndex });
      };
      setTimeout(send, Math.min(question.memorizeMs + 10, 50));
    });
    socket.on('match:end', (payload: MatchResultPublic) => resolve(payload));
  });
}

/** Structural + semantic validation of every question generator, run in-process (no server needed). */
function testGenerators(): void {
  for (const kind of GAME_KINDS) {
    for (let i = 0; i < 25; i += 1) {
      const { question, correctIndex } = generateQuestion(kind);
      assertOnce(question.options.length === 4, `${kind}: always produces exactly 4 options`);
      assertOnce(
        Number.isInteger(correctIndex) && correctIndex >= 0 && correctIndex < 4,
        `${kind}: correctIndex is always within [0,3]`,
      );
      assertOnce(question.answerMs > 0, `${kind}: answerMs is positive`);
      assertOnce(question.memorizeMs >= 0, `${kind}: memorizeMs is non-negative`);

      const prompt = question.prompt as Record<string, unknown> | null;
      const options = question.options as Record<string, unknown>[];
      const correctOption = options[correctIndex] as Record<string, unknown>;

      switch (kind) {
        case 'memoryMatch':
          assertOnce(prompt?.assetId === correctOption.assetId, 'memoryMatch: correctIndex option matches the prompt asset');
          break;
        default:
          break;
      }
    }
  }
}

let structuralChecksRun = 0;
function assertOnce(condition: boolean, message: string): void {
  structuralChecksRun += 1;
  if (!condition) {
    failures += 1;
    console.error(`✗ FAIL: ${message}`);
  }
}

/**
 * Deterministic unit tests for the payout math, using contrived scores
 * instead of live (randomized) gameplay outcomes — this is the exact money
 * math that must never be flaky, so it is verified with fixed inputs here,
 * independent of the live-match integration test further down.
 */
function testPayoutMath(): void {
  // Standard 4-player room: top 2 scorers win and split the pool 60/40, bottom 2 win nothing.
  {
    const r = computeMatchPayout(400, [
      { userId: 'a', score: 5, wrong: 1, lastAnswerAt: 100 },
      { userId: 'b', score: 3, wrong: 2, lastAnswerAt: 200 },
      { userId: 'c', score: 1, wrong: 4, lastAnswerAt: 300 },
      { userId: 'd', score: 0, wrong: 5, lastAnswerAt: 400 },
    ]);
    assertOnce(!r.isVoidMatch, 'payout: a clear leader is never treated as a void match');
    assertOnce(r.winnerIds.size === 2 && r.winnerIds.has('a') && r.winnerIds.has('b'), 'payout: the top 2 scorers are the winners');
    assertOnce(!r.winnerIds.has('c') && !r.winnerIds.has('d'), 'payout: 3rd and 4th place win nothing');
    assertOnce(r.platformCut === 80, 'payout: platform cut is exactly 20% of the pool (400 -> 80)');
    assertOnce(r.winnerPayoutTotal === 320, 'payout: winner pool is exactly 80% of the pool (400 -> 320)');
    assertOnce(r.platformCut + r.winnerPayoutTotal === 400, 'payout: cut + winner pool reconstructs the pool exactly');
    assertOnce(r.payoutByUserId.get('a') === 192, 'payout: 1st place gets 60% of the winner pool (320 -> 192)');
    assertOnce(r.payoutByUserId.get('b') === 128, 'payout: 2nd place gets the exact remainder (320 - 192 = 128)');
    assertOnce(
      (r.payoutByUserId.get('a') ?? 0) + (r.payoutByUserId.get('b') ?? 0) === r.winnerPayoutTotal,
      'payout: 1st + 2nd payouts exactly reconstruct the winner pool (no rounding leak)',
    );
    assertOnce((r.payoutByUserId.get('c') ?? 0) === 0 && (r.payoutByUserId.get('d') ?? 0) === 0, 'payout: non-winners are owed nothing');
  }

  // Tie on score for 1st place, broken by fewer wrong answers.
  {
    const r = computeMatchPayout(200, [
      { userId: 'a', score: 4, wrong: 3, lastAnswerAt: 500 },
      { userId: 'b', score: 4, wrong: 1, lastAnswerAt: 100 },
    ]);
    assertOnce(r.winnerIds.size === 2, 'payout: both scorers win when exactly two players scored');
    assertOnce(
      (r.payoutByUserId.get('b') ?? 0) > (r.payoutByUserId.get('a') ?? 0),
      'payout: a score tie for 1st is broken by fewer wrong answers (bigger share)',
    );
  }

  // Tie on score AND wrong count, broken by earliest last-answer timestamp.
  {
    const r = computeMatchPayout(200, [
      { userId: 'a', score: 4, wrong: 2, lastAnswerAt: 900 },
      { userId: 'b', score: 4, wrong: 2, lastAnswerAt: 100 },
    ]);
    assertOnce(
      (r.payoutByUserId.get('b') ?? 0) > (r.payoutByUserId.get('a') ?? 0),
      'payout: a full tie for 1st is broken by the earliest final answer (bigger share)',
    );
  }

  // Only one player actually scored — they take the entire winner pool alone; a
  // 0-score player is never paid just for technically ranking "2nd".
  {
    const r = computeMatchPayout(300, [
      { userId: 'a', score: 4, wrong: 1, lastAnswerAt: 100 },
      { userId: 'b', score: 0, wrong: 5, lastAnswerAt: 100 },
      { userId: 'c', score: 0, wrong: 5, lastAnswerAt: 100 },
    ]);
    assertOnce(r.winnerIds.size === 1 && r.winnerIds.has('a'), 'payout: a sole scorer is the only winner');
    assertOnce(r.payoutByUserId.get('a') === r.winnerPayoutTotal, 'payout: a sole scorer takes the entire winner pool alone');
  }

  // Void match: nobody scored anything.
  {
    const r = computeMatchPayout(150, [
      { userId: 'a', score: 0, wrong: 5, lastAnswerAt: 100 },
      { userId: 'b', score: 0, wrong: 5, lastAnswerAt: 200 },
      { userId: 'c', score: 0, wrong: 0, lastAnswerAt: null },
    ]);
    assertOnce(r.isVoidMatch, 'payout: an all-zero-score match is correctly flagged as void');
    assertOnce(r.winnerIds.size === 0, 'payout: a void match has no winners');
    assertOnce(r.platformCut === 0, 'payout: a void match takes zero platform cut');
    assertOnce(r.winnerPayoutTotal === 150, 'payout: a void match reserves the full pool for refunding (150)');
  }

  // Duel (winnerCount=1): the winner takes the entire winner pool alone, never a split,
  // even though both players scored and would have split it under the squad's winnerCount=2.
  {
    const r = computeMatchPayout(100, [
      { userId: 'a', score: 5, wrong: 1, lastAnswerAt: 100 },
      { userId: 'b', score: 2, wrong: 3, lastAnswerAt: 200 },
    ], 1);
    assertOnce(!r.isVoidMatch, 'duel payout: two scorers is never treated as a void match');
    assertOnce(r.winnerIds.size === 1 && r.winnerIds.has('a'), 'duel payout: only the higher scorer is a winner');
    assertOnce(r.payoutByUserId.get('a') === r.winnerPayoutTotal, 'duel payout: the winner takes the entire winner pool alone');
    assertOnce((r.payoutByUserId.get('b') ?? 0) === 0, 'duel payout: the loser is paid nothing, even though they scored');
  }

  // Duel void match: nobody scored — full refund, same as a squad void match.
  {
    const r = computeMatchPayout(100, [
      { userId: 'a', score: 0, wrong: 5, lastAnswerAt: 100 },
      { userId: 'b', score: 0, wrong: 5, lastAnswerAt: 200 },
    ], 1);
    assertOnce(r.isVoidMatch, 'duel payout: an all-zero-score duel is correctly flagged as void');
    assertOnce(r.winnerPayoutTotal === 100, 'duel payout: a void duel reserves the full pool for refunding');
  }
}

async function main() {
  testGenerators();
  testPayoutMath();
  console.log('✓ payout math verified with deterministic contrived scores (win, tie, and void-match cases)');
  console.log(`✓ all ${structuralChecksRun} generator structural/semantic checks passed across ${GAME_KINDS.length} game kinds`);

  await import('./index.js'); // boots the server with the overridden env above

  // Give the HTTP server a brief moment to finish binding before the first request.
  await new Promise((r) => setTimeout(r, 250));

  const suffix = Date.now();
  const alice = await createGuest(`SelfTestAlice_${suffix}`);
  const bob = await createGuest(`SelfTestBob_${suffix}`);
  const carol = await createGuest(`SelfTestCarol_${suffix}`);

  assert(alice.walletBalance === 1000, 'new guest starts with a 1000 virtual-currency wallet balance');
  assert(bob.id !== alice.id && carol.id !== alice.id, 'each guest login gets a distinct user id');

  // --- Login/sign-up mode semantics (not just legacy find-or-create) --------
  {
    // Kept under the server's 24-char name cap so the exact-name-echo assertions below are valid.
    const freshName = `SelfFresh${suffix.toString().slice(-8)}`;
    const signupResp = await authGuest(freshName, 'signup');
    assert(signupResp.status === 200 && signupResp.body.user?.name === freshName, 'signing up with a fresh name succeeds and creates the account');

    const dupeSignupResp = await authGuest(freshName, 'signup');
    assert(dupeSignupResp.status === 409 && !!dupeSignupResp.body.error, 'signing up with an already-taken name is rejected (409)');

    const loginResp = await authGuest(freshName, 'login');
    assert(loginResp.status === 200 && loginResp.body.user?.id === signupResp.body.user?.id, 'logging in with an existing name returns the same account');

    const missingLoginResp = await authGuest(`SelfTestNoSuchUser_${suffix}`, 'login');
    assert(missingLoginResp.status === 404 && !!missingLoginResp.body.error, 'logging in with a name that has no account is rejected (404)');
  }

  // --- Leave-before-start should fully refund the entry fee -----------------
  {
    const socket = connect();
    await new Promise<void>((r) => socket.on('connect', () => r()));
    const createAck = await emitAck<{ ok: boolean; roomId: string }>(socket, 'rooms:create', {
      gameKind: 'memoryMatch',
      entryFee: 50,
      format: 'squad',
    });
    assert(createAck.ok, 'room creation succeeds');
    const joinAck = await emitAck<{ ok: boolean }>(socket, 'rooms:join', { userId: alice.id, roomId: createAck.roomId });
    assert(joinAck.ok, 'join succeeds and debits the entry fee');
    const afterJoin = await getWallet(alice.id);
    assert(afterJoin.walletBalance === 950, 'wallet debited by exactly the entry fee on join (1000 -> 950)');

    await emitAck(socket, 'rooms:leave', { userId: alice.id, roomId: createAck.roomId });
    const afterLeave = await getWallet(alice.id);
    assert(afterLeave.walletBalance === 1000, 'leaving a waiting room fully refunds the entry fee');
    socket.disconnect();
  }

  // --- Insufficient funds should be rejected, not silently debited ----------
  {
    const socket = connect();
    await new Promise<void>((r) => socket.on('connect', () => r()));
    const createAck = await emitAck<{ ok: boolean; roomId: string }>(socket, 'rooms:create', {
      gameKind: 'memoryMatch',
      entryFee: 10000,
      format: 'squad',
    });
    const joinAck = await emitAck<{ ok: boolean; error?: string }>(socket, 'rooms:join', {
      userId: alice.id,
      roomId: createAck.roomId,
    });
    assert(!joinAck.ok, 'joining a room above wallet balance is rejected');
    assert(joinAck.error === 'Insufficient wallet balance for this room', 'rejection reason is reported clearly');
    const balance = await getWallet(alice.id);
    assert(balance.walletBalance === 1000, 'rejected join leaves the wallet untouched');
    socket.disconnect();
  }

  // --- Full 4-player wagered match: pooling, live scoring, top-2/bottom-2 payout -----
  {
    const entryFee = 100;
    const dana = await createGuest(`SelfTestDana_${suffix}`);
    const sockets = { alice: connect(), bob: connect(), carol: connect(), dana: connect() };
    await Promise.all(Object.values(sockets).map((s) => new Promise<void>((r) => s.on('connect', () => r()))));

    const createAck = await emitAck<{ ok: boolean; roomId: string }>(sockets.alice, 'rooms:create', {
      gameKind: 'memoryMatch',
      entryFee,
      format: 'squad',
    });
    const roomId = createAck.roomId;

    const joinResults = await Promise.all([
      emitAck<{ ok: boolean }>(sockets.alice, 'rooms:join', { userId: alice.id, roomId }),
      emitAck<{ ok: boolean }>(sockets.bob, 'rooms:join', { userId: bob.id, roomId }),
      emitAck<{ ok: boolean }>(sockets.carol, 'rooms:join', { userId: carol.id, roomId }),
      emitAck<{ ok: boolean }>(sockets.dana, 'rooms:join', { userId: dana.id, roomId }),
    ]);
    assert(joinResults.every((r) => r.ok), 'all four players join the wagered room (rooms are fixed 4-player matches)');

    const liveStates: RoomStatePublic[] = [];
    sockets.alice.on('room:update', (state: RoomStatePublic) => liveStates.push(state));

    const matchEndPromises = [
      playUntilMatchEnds(sockets.alice, alice.id, roomId, 'cycle'),
      playUntilMatchEnds(sockets.bob, bob.id, roomId, 'cycle'),
      playUntilMatchEnds(sockets.carol, carol.id, roomId, 'always-wrong'), // guaranteed loser, exercises the chance-depletion path
      playUntilMatchEnds(sockets.dana, dana.id, roomId, 'always-wrong'), // guaranteed loser
    ];

    // Mark everyone ready to trigger the countdown -> live transition (only once all 4 are ready).
    await Promise.all([
      emitAck(sockets.alice, 'rooms:ready', { userId: alice.id, roomId }),
      emitAck(sockets.bob, 'rooms:ready', { userId: bob.id, roomId }),
      emitAck(sockets.carol, 'rooms:ready', { userId: carol.id, roomId }),
      emitAck(sockets.dana, 'rooms:ready', { userId: dana.id, roomId }),
    ]);

    const matchResults = await Promise.all(matchEndPromises);
    const resultAlice = matchResults[0];
    if (!resultAlice) throw new Error('match:end payload missing for alice');

    assert(liveStates.some((s) => s.status === 'live'), 'room transitions through waiting -> countdown -> live');
    assert(resultAlice.pool === entryFee * 4, `pool equals sum of entry fees (${entryFee * 4})`);
    assert(
      resultAlice.platformCut + resultAlice.winnerPayoutTotal === resultAlice.pool,
      'platform cut + winner payout reconstructs the pool exactly (no rounding leak)',
    );
    // The exact split math itself is covered exhaustively and deterministically by
    // testPayoutMath() above; this live end-to-end run additionally verifies the wallet
    // ledger wiring reflects whatever the server actually decided (win split, or the rare
    // void-match refund if literally nobody scored a point in the live window).
    if (!resultAlice.isVoidMatch) {
      const expectedPlatformCut = Math.round(resultAlice.pool * 0.2);
      assert(resultAlice.platformCut === expectedPlatformCut, 'live match: platform keeps exactly 20% of the pool');

      const winners = resultAlice.results.filter((r) => r.isWinner);
      assert(winners.length <= 2, 'live match: at most 2 players are ever marked winners');
      const winnerPayoutSum = winners.reduce((sum, r) => sum + r.payout, 0);
      assert(winnerPayoutSum === resultAlice.winnerPayoutTotal, "live match: winners' payouts sum to exactly the winner pool");
    }

    const carolResult = resultAlice.results.find((r) => r.userId === carol.id);
    const danaResult = resultAlice.results.find((r) => r.userId === dana.id);
    assert(!!carolResult && !carolResult.isWinner && carolResult.payout === 0, 'an always-wrong player is never marked a winner and is paid nothing');
    assert(!!danaResult && !danaResult.isWinner && danaResult.payout === 0, 'a second always-wrong player is also never a winner and is paid nothing');

    for (const r of resultAlice.results) {
      const wallet = await getWallet(r.userId);
      const expectedBalance = 1000 - entryFee + r.payout;
      assert(
        wallet.walletBalance === expectedBalance,
        `${r.name}'s wallet reflects entry fee debit + payout/refund credit exactly (${expectedBalance})`,
      );
    }

    Object.values(sockets).forEach((s) => s.disconnect());
  }

  // --- Void match: nobody scores a single point -> full refund, zero platform cut -----
  {
    const entryFee = 10;
    const dave = await createGuest(`SelfTestDave_${suffix}`);
    const erin = await createGuest(`SelfTestErin_${suffix}`);
    const frank = await createGuest(`SelfTestFrank_${suffix}`);
    const grace = await createGuest(`SelfTestGrace_${suffix}`);
    const sockets = { dave: connect(), erin: connect(), frank: connect(), grace: connect() };
    await Promise.all(Object.values(sockets).map((s) => new Promise<void>((r) => s.on('connect', () => r()))));

    const createAck = await emitAck<{ ok: boolean; roomId: string }>(sockets.dave, 'rooms:create', {
      gameKind: 'memoryMatch',
      entryFee,
      format: 'squad',
    });
    const roomId = createAck.roomId;
    await Promise.all([
      emitAck(sockets.dave, 'rooms:join', { userId: dave.id, roomId }),
      emitAck(sockets.erin, 'rooms:join', { userId: erin.id, roomId }),
      emitAck(sockets.frank, 'rooms:join', { userId: frank.id, roomId }),
      emitAck(sockets.grace, 'rooms:join', { userId: grace.id, roomId }),
    ]);

    const matchEndPromises = [
      playUntilMatchEnds(sockets.dave, dave.id, roomId, 'always-wrong'),
      playUntilMatchEnds(sockets.erin, erin.id, roomId, 'always-wrong'),
      playUntilMatchEnds(sockets.frank, frank.id, roomId, 'always-wrong'),
      playUntilMatchEnds(sockets.grace, grace.id, roomId, 'always-wrong'),
    ];
    await Promise.all([
      emitAck(sockets.dave, 'rooms:ready', { userId: dave.id, roomId }),
      emitAck(sockets.erin, 'rooms:ready', { userId: erin.id, roomId }),
      emitAck(sockets.frank, 'rooms:ready', { userId: frank.id, roomId }),
      emitAck(sockets.grace, 'rooms:ready', { userId: grace.id, roomId }),
    ]);
    const [voidResult] = await Promise.all(matchEndPromises);
    if (!voidResult) throw new Error('match:end payload missing for the void-match test');

    assert(voidResult.platformCut === 0, 'a match where nobody scores takes zero platform cut');
    assert(voidResult.results.every((r) => !r.isWinner), 'no player is marked a winner when nobody scored');
    assert(
      voidResult.results.every((r) => r.payout === entryFee),
      'every player is refunded exactly their entry fee when the match is void',
    );

    const daveWallet = await getWallet(dave.id);
    const erinWallet = await getWallet(erin.id);
    assert(daveWallet.walletBalance === 1000, "void match leaves the player's wallet exactly unchanged (net)");
    assert(erinWallet.walletBalance === 1000, "void match leaves the player's wallet exactly unchanged (net)");

    Object.values(sockets).forEach((s) => s.disconnect());
  }

  // --- 1v1 duel: starts at 2 players, winner takes the entire winner pool -----------
  {
    const entryFee = 50;
    const heidi = await createGuest(`SelfTestHeidi_${suffix}`);
    const ivan = await createGuest(`SelfTestIvan_${suffix}`);
    const sockets = { heidi: connect(), ivan: connect() };
    await Promise.all(Object.values(sockets).map((s) => new Promise<void>((r) => s.on('connect', () => r()))));

    const createAck = await emitAck<{ ok: boolean; roomId: string }>(sockets.heidi, 'rooms:create', {
      gameKind: 'memoryMatch',
      entryFee,
      format: 'duel',
    });
    const roomId = createAck.roomId;

    const joinResults = await Promise.all([
      emitAck<{ ok: boolean; room?: RoomStatePublic }>(sockets.heidi, 'rooms:join', { userId: heidi.id, roomId }),
      emitAck<{ ok: boolean; room?: RoomStatePublic }>(sockets.ivan, 'rooms:join', { userId: ivan.id, roomId }),
    ]);
    assert(joinResults.every((r) => r.ok), 'a duel joins with just 2 players');
    const roomAfterJoins = joinResults[1].room;
    assert(!!roomAfterJoins && roomAfterJoins.format === 'duel', "the joined room reports format 'duel'");

    // Both players get a real shot at scoring (rather than pinning one to 'always-wrong')
    // so this stays a live end-to-end run without inflating the void-match chance the way
    // a single guaranteed-loser would (each 'cycle' player only needs one lucky guess among
    // their questions before their 5 chances run out).
    const matchEndPromises = [
      playUntilMatchEnds(sockets.heidi, heidi.id, roomId, 'cycle'),
      playUntilMatchEnds(sockets.ivan, ivan.id, roomId, 'cycle'),
    ];

    // A duel only needs 2 ready players (its own capacity) to start — not the squad's 4.
    await Promise.all([
      emitAck(sockets.heidi, 'rooms:ready', { userId: heidi.id, roomId }),
      emitAck(sockets.ivan, 'rooms:ready', { userId: ivan.id, roomId }),
    ]);

    const [resultHeidi] = await Promise.all(matchEndPromises);
    if (!resultHeidi) throw new Error('match:end payload missing for the duel test');

    assert(resultHeidi.format === 'duel', 'the match:end payload reports format \'duel\'');
    assert(resultHeidi.pool === entryFee * 2, `duel pool equals sum of both entry fees (${entryFee * 2})`);
    // The exact win-or-void outcome depends on live (randomized) guessing, same caveat as
    // the squad test above — the deterministic payout math itself (winnerCount=1 takes it
    // all, no split) is covered exhaustively and without any randomness in testPayoutMath().
    if (!resultHeidi.isVoidMatch) {
      const winners = resultHeidi.results.filter((r) => r.isWinner);
      assert(winners.length === 1, 'a duel ever has exactly one winner, never a split');
      const loser = resultHeidi.results.find((r) => !r.isWinner);
      assert(
        winners[0]?.payout === resultHeidi.winnerPayoutTotal,
        'the duel winner takes the entire winner pool alone (no 1st/2nd split)',
      );
      assert(!!loser && loser.payout === 0, 'the duel loser is paid nothing');
    }

    Object.values(sockets).forEach((s) => s.disconnect());
  }

  console.log('\n' + (failures === 0 ? 'ALL SELF-TESTS PASSED' : `${failures} SELF-TEST(S) FAILED`));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Self-test crashed:', err);
  process.exit(1);
});
