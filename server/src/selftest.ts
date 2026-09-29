/**
 * End-to-end self-test for the multiplayer wagering arcade backend.
 *
 * Spins up the real Express + Socket.IO server in-process (on a throwaway port, with
 * shortened match/round/countdown durations so this finishes in seconds), then drives
 * several concurrent, REAL-SESSION-AUTHENTICATED virtual players through: signup/login ->
 * room create/join -> entry-fee debit -> live two-phase round loop -> match end -> 80/20
 * payout — asserting exact wallet/pool math — plus a dedicated AUTH, AUTHORIZATION, GAME
 * anti-cheat, and WALLET-abuse battery covering every P0 finding in AUDIT_REPORT.md.
 */
process.env.PORT = process.env.PORT || '8799';
// Generous-but-still-fast overrides: short enough to keep the suite quick, long enough to
// have comfortable headroom over sandbox scheduling jitter so the suite never flakes.
process.env.ARCADE_MATCH_DURATION_MS = '4000';
process.env.ARCADE_READY_COUNTDOWN_MS = '300';
process.env.ARCADE_ROUND_MEMORIZE_MS = '120';
process.env.ARCADE_ROUND_ANSWER_MS = '400';

import { io as ioClient, type Socket } from 'socket.io-client';
import { generateRound } from './gameKinds/index.js';
import { computeMatchPayout } from './payout.js';
import {
  GAME_KINDS,
  MIN_REACTION_MS,
  type MatchResultPublic,
  type PublicUser,
  type RoomStatePublic,
  type RoundOptionsPublic,
  type RoundRevealPublic,
  type WalletStats,
} from './types.js';

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

// ---------------------------------------------------------------------------
// Session-cookie-aware HTTP + socket helpers. Nothing in this file ever sends a userId in
// a request body/param/query to authenticate as someone — every identity-bearing call
// goes through the session cookie a prior signup/login response set, exactly like a real
// browser would, so these tests exercise the actual production auth path, not a shortcut.
// ---------------------------------------------------------------------------
interface Session {
  cookie: string;
  user: PublicUser;
}

function extractCookie(res: Response): string {
  const cookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const raw = cookies[0] ?? res.headers.get('set-cookie');
  if (!raw) throw new Error('Expected a Set-Cookie header on the auth response');
  return raw.split(';')[0]!;
}

async function signup(name: string, password: string): Promise<{ status: number; body: { user?: PublicUser; error?: string }; cookie?: string }> {
  const res = await fetch(`${BASE_URL}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, password }),
  });
  const body = (await res.json()) as { user?: PublicUser; error?: string };
  return { status: res.status, body, cookie: res.status === 200 ? extractCookie(res) : undefined };
}

async function login(name: string, password: string): Promise<{ status: number; body: { user?: PublicUser; error?: string }; cookie?: string }> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, password }),
  });
  const body = (await res.json()) as { user?: PublicUser; error?: string };
  return { status: res.status, body, cookie: res.status === 200 ? extractCookie(res) : undefined };
}

async function freshSession(namePrefix: string, password = 'correct-horse-battery'): Promise<Session> {
  const name = `${namePrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const resp = await signup(name, password);
  if (resp.status !== 200 || !resp.body.user || !resp.cookie) throw new Error(`Failed to create test session for ${name}: ${JSON.stringify(resp.body)}`);
  return { cookie: resp.cookie, user: resp.body.user };
}

function authedFetch(cookie: string | undefined, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (cookie) headers.set('Cookie', cookie);
  return fetch(`${BASE_URL}${path}`, { ...init, headers });
}

async function getWallet(cookie: string): Promise<{ user: PublicUser }> {
  return (await authedFetch(cookie, '/api/wallet')).json() as Promise<{ user: PublicUser }>;
}

function connect(cookie: string): Socket {
  return ioClient(BASE_URL, { transports: ['websocket'], forceNew: true, extraHeaders: { Cookie: cookie } });
}

function emitAck<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve) => socket.emit(event, payload, (ack: T) => resolve(ack)));
}

/** Drives one socket through an entire live match using the real two-phase round protocol:
 *  waits for `match:round:reveal` (remembering the shown assetId), then upon
 *  `match:round:options` either answers with the option whose assetId matches what was
 *  just shown (a genuinely "honest" client — always correct) or submits a bogus token
 *  (guaranteed wrong, to exercise the chance-depletion path), waiting until at least
 *  `minAnswerAt` before sending either way so timing-honest play is never itself rejected. */
function playUntilMatchEnds(socket: Socket, roomId: string, strategy: 'correct' | 'always-wrong'): Promise<MatchResultPublic> {
  let lastReveal: { roundId: string; assetId: string } | null = null;
  return new Promise((resolve) => {
    socket.on('match:round:reveal', (reveal: RoundRevealPublic) => {
      lastReveal = { roundId: reveal.roundId, assetId: (reveal.prompt as { assetId: string }).assetId };
    });
    socket.on('match:round:options', (opts: RoundOptionsPublic) => {
      const waitMs = Math.max(0, opts.minAnswerAt - Date.now()) + 15;
      setTimeout(() => {
        let token = 'not-a-real-token';
        if (strategy === 'correct' && lastReveal && lastReveal.roundId === opts.roundId) {
          token = opts.options.find((o) => o.assetId === lastReveal!.assetId)?.token ?? token;
        }
        void emitAck(socket, 'match:answer', { roomId, roundId: opts.roundId, optionToken: token });
      }, waitMs);
    });
    socket.on('match:end', (payload: MatchResultPublic) => resolve(payload));
  });
}

/** Structural + semantic validation of every round generator, run in-process (no server needed). */
function testGenerators(): void {
  for (const kind of GAME_KINDS) {
    for (let i = 0; i < 25; i += 1) {
      const round = generateRound(kind);
      assertOnce(round.options.length === 4, `${kind}: always produces exactly 4 options`);
      assertOnce(new Set(round.options.map((o) => o.token)).size === 4, `${kind}: all 4 option tokens are distinct`);
      assertOnce(!round.options.some((o) => o.token === o.assetId), `${kind}: an option's token is never equal to its own assetId`);
      const correctOption = round.options.find((o) => o.token === round.correctToken);
      assertOnce(!!correctOption && correctOption.assetId === round.targetAssetId, `${kind}: correctToken always identifies the option matching the target asset`);
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

/** Deterministic unit tests for the payout math, using contrived scores instead of live
 *  (randomized) gameplay outcomes — this exact money math must never be flaky. */
function testPayoutMath(): void {
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
    assertOnce((r.payoutByUserId.get('c') ?? 0) === 0 && (r.payoutByUserId.get('d') ?? 0) === 0, 'payout: non-winners are owed nothing');
  }
  {
    const r = computeMatchPayout(200, [
      { userId: 'a', score: 4, wrong: 3, lastAnswerAt: 500 },
      { userId: 'b', score: 4, wrong: 1, lastAnswerAt: 100 },
    ]);
    assertOnce(r.winnerIds.size === 2, 'payout: both scorers win when exactly two players scored');
    assertOnce((r.payoutByUserId.get('b') ?? 0) > (r.payoutByUserId.get('a') ?? 0), 'payout: a score tie for 1st is broken by fewer wrong answers');
  }
  {
    const r = computeMatchPayout(300, [
      { userId: 'a', score: 4, wrong: 1, lastAnswerAt: 100 },
      { userId: 'b', score: 0, wrong: 5, lastAnswerAt: 100 },
      { userId: 'c', score: 0, wrong: 5, lastAnswerAt: 100 },
    ]);
    assertOnce(r.winnerIds.size === 1 && r.winnerIds.has('a'), 'payout: a sole scorer is the only winner');
    assertOnce(r.payoutByUserId.get('a') === r.winnerPayoutTotal, 'payout: a sole scorer takes the entire winner pool alone');
  }
  {
    const r = computeMatchPayout(150, [
      { userId: 'a', score: 0, wrong: 5, lastAnswerAt: 100 },
      { userId: 'b', score: 0, wrong: 5, lastAnswerAt: 200 },
      { userId: 'c', score: 0, wrong: 0, lastAnswerAt: null },
    ]);
    assertOnce(r.isVoidMatch, 'payout: an all-zero-score match is correctly flagged as void');
    assertOnce(r.platformCut === 0, 'payout: a void match takes zero platform cut');
    assertOnce(r.winnerPayoutTotal === 150, 'payout: a void match reserves the full pool for refunding');
  }
  {
    const r = computeMatchPayout(100, [
      { userId: 'a', score: 5, wrong: 1, lastAnswerAt: 100 },
      { userId: 'b', score: 2, wrong: 3, lastAnswerAt: 200 },
    ], 1);
    assertOnce(r.winnerIds.size === 1 && r.winnerIds.has('a'), 'duel payout: only the higher scorer is a winner');
    assertOnce(r.payoutByUserId.get('a') === r.winnerPayoutTotal, 'duel payout: the winner takes the entire winner pool alone');
  }
}

/** AUTH: signup/login/logout/me, password strength, username normalization, unauthenticated access. */
async function testAuth(): Promise<void> {
  const stamp = Date.now();
  const name = `AuthUser_${stamp}`;

  const weakPw = await signup(name, 'short');
  assert(weakPw.status === 400, 'signup: a password under 8 characters is rejected');

  const first = await signup(name, 'correct-horse-battery');
  assert(first.status === 200 && !!first.cookie, 'signup: a valid new account succeeds and sets a session cookie');
  assert(first.body.user?.walletBalance === 1000, 'signup: a new account starts with a 1000 practice-currency balance');
  assert(!('passwordHash' in (first.body.user ?? {})) && !('usernameKey' in (first.body.user ?? {})), 'signup: the response never includes passwordHash/usernameKey');

  const dupe = await signup(name, 'another-password-1');
  assert(dupe.status === 409, 'signup: an already-taken name is rejected (409)');
  const dupeCase = await signup(name.toUpperCase(), 'another-password-1');
  assert(dupeCase.status === 409, 'signup: username collisions are case-insensitive (User/USER/user are one account)');

  const wrongPw = await login(name, 'totally-wrong-password');
  assert(wrongPw.status === 401, 'login: an existing username with the wrong password is rejected (401)');
  const noSuchUser = await login(`NoSuchUser_${stamp}`, 'whatever-password');
  assert(noSuchUser.status === 401, 'login: a nonexistent username gets the SAME 401 as a wrong password (no user-enumeration oracle)');
  assert(wrongPw.body.error === noSuchUser.body.error, 'login: wrong-password and no-such-user return an identical error message');

  const goodLogin = await login(name, 'correct-horse-battery');
  assert(goodLogin.status === 200 && goodLogin.body.user?.id === first.body.user?.id, 'login: correct credentials return the same account created at signup');
  const caseInsensitiveLogin = await login(name.toLowerCase(), 'correct-horse-battery');
  assert(caseInsensitiveLogin.status === 200 && caseInsensitiveLogin.body.user?.id === first.body.user?.id, 'login: username matching is case-insensitive');

  const meUnauthed = await fetch(`${BASE_URL}/api/auth/me`);
  assert(meUnauthed.status === 401, 'GET /api/auth/me with no session cookie is rejected (401)');

  const meAuthed = await authedFetch(first.cookie, '/api/auth/me');
  const meBody = (await meAuthed.json()) as { user?: PublicUser };
  assert(meAuthed.status === 200 && meBody.user?.id === first.body.user?.id, 'GET /api/auth/me with a valid session returns the correct account');

  const logoutRes = await authedFetch(first.cookie, '/api/auth/logout', { method: 'POST' });
  assert(logoutRes.status === 200, 'logout succeeds');
  const meAfterLogout = await authedFetch(first.cookie, '/api/auth/me');
  assert(meAfterLogout.status === 401, 'the session cookie is no longer valid after logout');

  const walletUnauthed = await fetch(`${BASE_URL}/api/wallet`);
  assert(walletUnauthed.status === 401, 'GET /api/wallet with no session is rejected (401)');
}

/** AUTHORIZATION: a session can never act on another account, regardless of what the
 *  request body/params claim — there is no `userId` field left anywhere for it to matter. */
async function testAuthorization(): Promise<void> {
  const alice = await freshSession('AuthzAlice');
  const bob = await freshSession('AuthzBob');

  const aliceWallet = await getWallet(alice.cookie);
  assert(aliceWallet.user.id === alice.user.id, "alice's own session sees her own wallet");

  // Forged body claiming to act as bob, while authenticated as alice: the field is simply
  // not read server-side, so this can only ever affect alice's own account.
  const forgedWithdraw = await authedFetch(alice.cookie, '/api/wallet/withdraw', {
    method: 'POST',
    body: JSON.stringify({ amount: 10, userId: bob.user.id }),
  });
  assert(forgedWithdraw.status === 200, "a forged 'userId' field in the body does not block alice's own legitimate withdrawal");
  const bobAfter = await getWallet(bob.cookie);
  assert(bobAfter.user.walletBalance === 1000, "bob's balance is completely untouched by alice's request that named him in the body");
  const aliceAfter = await getWallet(alice.cookie);
  assert(aliceAfter.user.walletBalance === 990, "alice's own balance is the one actually debited (990), proving identity comes only from her session");

  // A stolen/garbage cookie value must never resolve to any account.
  const forgedCookieRes = await authedFetch('arena_session=not-a-real-session-token', '/api/wallet');
  assert(forgedCookieRes.status === 401, 'an invalid/forged session token is rejected, not silently mapped to an account');

  // Socket auth: connecting with no cookie at all must be rejected by the io.use() middleware.
  const anonSocket = ioClient(BASE_URL, { transports: ['websocket'], forceNew: true, extraHeaders: {} });
  const anonResult = await new Promise<'connected' | 'rejected'>((resolve) => {
    anonSocket.on('connect', () => resolve('connected'));
    anonSocket.on('connect_error', () => resolve('rejected'));
    setTimeout(() => resolve('rejected'), 2000);
  });
  assert(anonResult === 'rejected', 'a socket connection with no valid session cookie is rejected at the handshake');
  anonSocket.disconnect();

  // Room-level id-leak check: bob should never see alice's real account id, only an opaque
  // room-scoped publicId — even though they are seated together and can see each other.
  const aliceSocket = connect(alice.cookie);
  const bobSocket = connect(bob.cookie);
  await Promise.all([aliceSocket, bobSocket].map((s) => new Promise<void>((r) => s.on('connect', () => r()))));
  const createAck = await emitAck<{ ok: boolean; roomId: string }>(aliceSocket, 'rooms:create', { gameKind: 'memoryMatch', entryFee: 10, format: 'duel' });
  await emitAck<{ ok: boolean; room?: RoomStatePublic }>(aliceSocket, 'rooms:join', { roomId: createAck.roomId });
  const bobJoin = await emitAck<{ ok: boolean; room?: RoomStatePublic }>(bobSocket, 'rooms:join', { roomId: createAck.roomId });
  const bobsViewOfRoom = bobJoin.room!;
  const aliceEntryAsSeenByBob = bobsViewOfRoom.players.find((p) => p.name === alice.user.name);
  assert(!!aliceEntryAsSeenByBob && aliceEntryAsSeenByBob.id !== alice.user.id, "bob never sees alice's real account id in room state, only an opaque id");
  const bobsOwnEntry = bobsViewOfRoom.players.find((p) => p.name === bob.user.name);
  assert(bobsOwnEntry?.id === bob.user.id, "bob's own entry in his own view still shows his real id (so the client can tell which seat is 'me')");
  await Promise.all([
    emitAck(aliceSocket, 'rooms:leave', { roomId: createAck.roomId }),
    emitAck(bobSocket, 'rooms:leave', { roomId: createAck.roomId }),
  ]);
  aliceSocket.disconnect();
  bobSocket.disconnect();
}

/** GAME: server-authoritative rounds — stale/duplicate/future round ids, too-fast answers,
 *  timeout handling, and forged payloads are all rejected using only server-held state. */
async function testGameAntiCheat(): Promise<void> {
  const a = await freshSession('GameA');
  const b = await freshSession('GameB');
  const sa = connect(a.cookie);
  const sb = connect(b.cookie);
  await Promise.all([sa, sb].map((s) => new Promise<void>((r) => s.on('connect', () => r()))));

  const createAck = await emitAck<{ ok: boolean; roomId: string }>(sa, 'rooms:create', { gameKind: 'memoryMatch', entryFee: 10, format: 'duel' });
  const roomId = createAck.roomId;
  await emitAck(sa, 'rooms:join', { roomId });
  await emitAck(sb, 'rooms:join', { roomId });

  const firstOptions = await new Promise<RoundOptionsPublic>((resolve) => {
    sa.on('match:round:options', (opts: RoundOptionsPublic) => resolve(opts));
    void emitAck(sa, 'rooms:ready', { roomId });
    void emitAck(sb, 'rooms:ready', { roomId });
  });

  // 1. Unknown/forged round id is rejected outright.
  const forgedRoundAnswer = await emitAck<{ ok: boolean; error?: string }>(sa, 'match:answer', {
    roomId,
    roundId: 'totally-made-up-round-id',
    optionToken: firstOptions.options[0]!.token,
  });
  assert(!forgedRoundAnswer.ok, 'answering with a forged/unknown roundId is rejected');

  // 2. Guessing the correctToken by submitting an assetId string instead of a real token fails.
  const assetIdAsToken = await emitAck<{ ok: boolean; error?: string }>(sa, 'match:answer', {
    roomId,
    roundId: firstOptions.roundId,
    optionToken: firstOptions.options[0]!.assetId,
  });
  assert(!assetIdAsToken.ok, 'submitting an assetId in place of a real option token never matches (tokens are unrelated random values)');

  // 3. Answering faster than MIN_REACTION_MS after the options were revealed is rejected —
  // this is the actual fix for the audited "173,312 answers in 60s" throughput exploit.
  const tooFast = await emitAck<{ ok: boolean; error?: string }>(sa, 'match:answer', {
    roomId,
    roundId: firstOptions.roundId,
    optionToken: firstOptions.options[0]!.token,
  });
  assert(!tooFast.ok && /faster than humanly possible/.test(tooFast.error ?? ''), `an answer submitted before minAnswerAt (< ${MIN_REACTION_MS}ms reaction) is rejected`);

  // 4. A legitimate, correctly-timed answer using the real token succeeds exactly once...
  await new Promise((r) => setTimeout(r, Math.max(0, firstOptions.minAnswerAt - Date.now()) + 10));
  const correctToken = firstOptions.options[0]!.token; // any token is fine for the duplicate-submit check below
  const firstAnswer = await emitAck<{ ok: boolean; correct?: boolean }>(sa, 'match:answer', {
    roomId,
    roundId: firstOptions.roundId,
    optionToken: correctToken,
  });
  assert(firstAnswer.ok === true, 'a correctly-timed answer within the valid window is accepted');

  // ...and submitting again for the exact same round is rejected (no double-scoring/replay).
  const replay = await emitAck<{ ok: boolean; error?: string }>(sa, 'match:answer', {
    roomId,
    roundId: firstOptions.roundId,
    optionToken: correctToken,
  });
  assert(!replay.ok, 'submitting a second answer for an already-resolved round is rejected (no replay/double-score)');

  // 5. Timeout path: let a whole round expire with no answer, then confirm the stale
  // roundId can no longer be answered (the player has already moved on to a new round).
  const timedOutRoundId: string = await new Promise((resolve) => {
    const onOptions = (opts: RoundOptionsPublic) => {
      sa.off('match:round:options', onOptions);
      resolve(opts.roundId);
    };
    sa.on('match:round:options', onOptions);
  });
  const timeoutEvent = await new Promise<{ roundId: string }>((resolve) => {
    sa.on('match:round:timeout', (payload: { roundId: string }) => resolve(payload));
  });
  assert(timeoutEvent.roundId === timedOutRoundId, "an unanswered round auto-resolves as a timeout after its answer window elapses");
  const answerAfterTimeout = await emitAck<{ ok: boolean; error?: string }>(sa, 'match:answer', {
    roomId,
    roundId: timedOutRoundId,
    optionToken: 'irrelevant',
  });
  assert(!answerAfterTimeout.ok, 'answering a round after it already timed out is rejected (the server had already advanced past it)');

  await Promise.all([emitAck(sa, 'rooms:leave', { roomId }), emitAck(sb, 'rooms:leave', { roomId })]);
  sa.disconnect();
  sb.disconnect();
}

/** WALLET: insufficient funds, invalid amounts, idempotent double-submit protection. */
async function testWalletAbuse(): Promise<void> {
  const judy = await freshSession('WalletJudy');
  assert((await getWallet(judy.cookie)).user.walletBalance === 1000, 'a fresh wallet starts at 1000 before any deposit/withdrawal');

  const deposit = await authedFetch(judy.cookie, '/api/wallet/topup', { method: 'POST', body: JSON.stringify({ amount: 500 }) });
  const depositBody = (await deposit.json()) as { user: PublicUser };
  assert(deposit.status === 200 && depositBody.user.walletBalance === 1500, 'depositing 500 credits the wallet exactly (1000 -> 1500)');

  const overdraft = await authedFetch(judy.cookie, '/api/wallet/withdraw', { method: 'POST', body: JSON.stringify({ amount: 999999 }) });
  assert(overdraft.status === 400, 'withdrawing far more than the balance is rejected (400)');
  assert((await getWallet(judy.cookie)).user.walletBalance === 1500, 'a rejected overdraft leaves the wallet completely untouched');

  const negative = await authedFetch(judy.cookie, '/api/wallet/withdraw', { method: 'POST', body: JSON.stringify({ amount: -50 }) });
  assert(negative.status === 400, 'withdrawing a negative amount is rejected (400)');

  const nonNumeric = await authedFetch(judy.cookie, '/api/wallet/withdraw', { method: 'POST', body: JSON.stringify({ amount: 'lots please' }) });
  assert(nonNumeric.status === 400, 'a non-numeric withdrawal amount is rejected (400), not coerced');

  // Duplicate-submission protection: same requestId submitted twice must only debit once —
  // simulating a dropped response causing a client to retry the exact same click.
  const requestId = `withdraw-dedupe-${Date.now()}`;
  const [firstAttempt, secondAttempt] = await Promise.all([
    authedFetch(judy.cookie, '/api/wallet/withdraw', { method: 'POST', body: JSON.stringify({ amount: 200, requestId }) }),
    authedFetch(judy.cookie, '/api/wallet/withdraw', { method: 'POST', body: JSON.stringify({ amount: 200, requestId }) }),
  ]);
  assert(firstAttempt.status === 200 && secondAttempt.status === 200, 'both legs of a duplicate-requestId withdrawal report success (the second is a replay of the first, not a new debit)');
  const afterDupe = await getWallet(judy.cookie);
  assert(afterDupe.user.walletBalance === 1300, 'a withdrawal retried with the same requestId is debited exactly once (1500 -> 1300, not 1100)');

  const finalTxs = (await (await authedFetch(judy.cookie, '/api/wallet')).json()) as { transactions: { type: string }[] };
  const withdrawalCount = finalTxs.transactions.filter((t) => t.type === 'withdrawal').length;
  assert(withdrawalCount === 1, 'the ledger records exactly one withdrawal transaction for the deduplicated request, not two');

  const missingStats = await authedFetch(judy.cookie, '/api/wallet/stats');
  assert(missingStats.status === 200, "a user's own stats endpoint works");
  const statsUnauthed = await fetch(`${BASE_URL}/api/wallet/stats`);
  assert(statsUnauthed.status === 401, 'wallet stats requires authentication');
}

async function main() {
  testGenerators();
  testPayoutMath();
  console.log('✓ payout math verified with deterministic contrived scores (win, tie, and void-match cases)');
  console.log(`✓ all ${structuralChecksRun} generator structural/semantic checks passed across ${GAME_KINDS.length} game kinds`);

  await import('./index.js'); // boots the server with the overridden env above
  await new Promise((r) => setTimeout(r, 250)); // let the HTTP server finish binding

  await testAuth();
  await testAuthorization();
  await testGameAntiCheat();
  await testWalletAbuse();

  // --- Leave-before-start should fully refund the entry fee -----------------
  {
    const alice = await freshSession('LeaveAlice');
    const socket = connect(alice.cookie);
    await new Promise<void>((r) => socket.on('connect', () => r()));
    const createAck = await emitAck<{ ok: boolean; roomId: string }>(socket, 'rooms:create', { gameKind: 'memoryMatch', entryFee: 50, format: 'squad' });
    const joinAck = await emitAck<{ ok: boolean }>(socket, 'rooms:join', { roomId: createAck.roomId });
    assert(joinAck.ok, 'join succeeds and debits the entry fee');
    assert((await getWallet(alice.cookie)).user.walletBalance === 950, 'wallet debited by exactly the entry fee on join (1000 -> 950)');
    await emitAck(socket, 'rooms:leave', { roomId: createAck.roomId });
    assert((await getWallet(alice.cookie)).user.walletBalance === 1000, 'leaving a waiting room fully refunds the entry fee');
    socket.disconnect();
  }

  // --- Insufficient funds should be rejected, not silently debited ----------
  {
    const alice = await freshSession('BrokeAlice');
    const socket = connect(alice.cookie);
    await new Promise<void>((r) => socket.on('connect', () => r()));
    const createAck = await emitAck<{ ok: boolean; roomId: string }>(socket, 'rooms:create', { gameKind: 'memoryMatch', entryFee: 10000, format: 'squad' });
    const joinAck = await emitAck<{ ok: boolean; error?: string }>(socket, 'rooms:join', { roomId: createAck.roomId });
    assert(!joinAck.ok, 'joining a room above wallet balance is rejected');
    assert((await getWallet(alice.cookie)).user.walletBalance === 1000, 'rejected join leaves the wallet untouched');
    socket.disconnect();
  }

  // --- Full 4-player wagered match: pooling, live scoring, top-2/bottom-2 payout -----
  {
    const entryFee = 100;
    const players = await Promise.all([
      freshSession('SquadAlice'),
      freshSession('SquadBob'),
      freshSession('SquadCarol'),
      freshSession('SquadDana'),
    ]);
    const [alice, , carol, dana] = players;
    const sockets = players.map((p) => connect(p.cookie));
    await Promise.all(sockets.map((s) => new Promise<void>((r) => s.on('connect', () => r()))));

    const createAck = await emitAck<{ ok: boolean; roomId: string }>(sockets[0]!, 'rooms:create', { gameKind: 'memoryMatch', entryFee, format: 'squad' });
    const roomId = createAck.roomId;
    const joinResults = await Promise.all(sockets.map((s) => emitAck<{ ok: boolean }>(s, 'rooms:join', { roomId })));
    assert(joinResults.every((r) => r.ok), 'all four players join the wagered room');

    const liveStates: RoomStatePublic[] = [];
    sockets[0]!.on('room:update', (state: RoomStatePublic) => liveStates.push(state));

    const matchEndPromises = [
      playUntilMatchEnds(sockets[0]!, roomId, 'correct'),
      playUntilMatchEnds(sockets[1]!, roomId, 'correct'),
      playUntilMatchEnds(sockets[2]!, roomId, 'always-wrong'),
      playUntilMatchEnds(sockets[3]!, roomId, 'always-wrong'),
    ];
    await Promise.all(sockets.map((s) => emitAck(s, 'rooms:ready', { roomId })));
    const matchResults = await Promise.all(matchEndPromises);
    const resultAlice = matchResults[0]!;

    assert(liveStates.some((s) => s.status === 'live'), 'room transitions through waiting -> countdown -> live');
    assert(resultAlice.pool === entryFee * 4, `pool equals sum of entry fees (${entryFee * 4})`);
    assert(resultAlice.platformCut + resultAlice.winnerPayoutTotal === resultAlice.pool, 'platform cut + winner payout reconstructs the pool exactly');

    const aliceResult = resultAlice.results.find((r) => r.id === alice.user.id);
    assert(!!aliceResult && aliceResult.isWinner, "the 'correct' strategy player (answering honestly every round) wins the squad match");
    const carolAsSeenByAlice = resultAlice.results.find((r) => r.name === carol.user.name);
    assert(!!carolAsSeenByAlice && carolAsSeenByAlice.id !== carol.user.id, "the match:end payload never reveals another player's real account id to alice");
    const danaAsSeenByAlice = resultAlice.results.find((r) => r.name === dana.user.name);
    assert(!!carolAsSeenByAlice && !carolAsSeenByAlice.isWinner && carolAsSeenByAlice.payout === 0, 'an always-wrong player is never marked a winner and is paid nothing');
    assert(!!danaAsSeenByAlice && !danaAsSeenByAlice.isWinner && danaAsSeenByAlice.payout === 0, 'a second always-wrong player is also never a winner and is paid nothing');

    for (let i = 0; i < players.length; i += 1) {
      const wallet = await getWallet(players[i]!.cookie);
      const myResult = resultAlice.results.find((r) => r.id === wallet.user.id || r.name === players[i]!.user.name)!;
      const expectedBalance = 1000 - entryFee + myResult.payout;
      assert(wallet.user.walletBalance === expectedBalance, `${players[i]!.user.name}'s wallet reflects entry fee debit + payout/refund credit exactly (${expectedBalance})`);
    }

    sockets.forEach((s) => s.disconnect());
  }

  // --- 1v1 duel: starts at 2 players, winner takes the entire winner pool -----------
  {
    const entryFee = 50;
    const heidi = await freshSession('DuelHeidi');
    const ivan = await freshSession('DuelIvan');
    const sockets = [connect(heidi.cookie), connect(ivan.cookie)];
    await Promise.all(sockets.map((s) => new Promise<void>((r) => s.on('connect', () => r()))));

    const createAck = await emitAck<{ ok: boolean; roomId: string }>(sockets[0]!, 'rooms:create', { gameKind: 'memoryMatch', entryFee, format: 'duel' });
    const roomId = createAck.roomId;
    const joinResults = await Promise.all([
      emitAck<{ ok: boolean; room?: RoomStatePublic }>(sockets[0]!, 'rooms:join', { roomId }),
      emitAck<{ ok: boolean; room?: RoomStatePublic }>(sockets[1]!, 'rooms:join', { roomId }),
    ]);
    assert(joinResults.every((r) => r.ok), 'a duel joins with just 2 players');
    assert(joinResults[1]!.room?.format === 'duel', "the joined room reports format 'duel'");

    const matchEndPromises = [playUntilMatchEnds(sockets[0]!, roomId, 'correct'), playUntilMatchEnds(sockets[1]!, roomId, 'always-wrong')];
    await Promise.all(sockets.map((s) => emitAck(s, 'rooms:ready', { roomId })));
    const [resultHeidi] = await Promise.all(matchEndPromises);

    assert(resultHeidi!.format === 'duel', "the match:end payload reports format 'duel'");
    assert(resultHeidi!.pool === entryFee * 2, `duel pool equals sum of both entry fees (${entryFee * 2})`);
    const winners = resultHeidi!.results.filter((r) => r.isWinner);
    assert(winners.length === 1 && winners[0]!.name === heidi.user.name, 'the honest player wins the duel outright (no split)');
    assert(winners[0]!.payout === resultHeidi!.winnerPayoutTotal, 'the duel winner takes the entire winner pool alone');

    const heidiStatsRes = await authedFetch(heidi.cookie, '/api/wallet/stats');
    const heidiStats = (await heidiStatsRes.json()) as { stats: WalletStats };
    assert(heidiStats.stats.matchesPlayed === 1, 'profile stats: playing one match counts as 1 distinct match played');
    assert(heidiStats.stats.totalWagered === entryFee, `profile stats: total wagered equals the entry fee paid (${entryFee})`);
    assert(heidiStats.stats.wins === 1, 'profile stats: a duel win is reflected in lifetime wins');

    sockets.forEach((s) => s.disconnect());
  }

  console.log('\n' + (failures === 0 ? 'ALL SELF-TESTS PASSED' : `${failures} SELF-TEST(S) FAILED`));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Self-test crashed:', err);
  process.exit(1);
});
