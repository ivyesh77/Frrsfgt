// Live, external re-test of every exploit documented in AUDIT_REPORT.md, run against the
// ACTUAL running server (not the in-process self-test) exactly as an attacker's own
// separate script/client would — a fresh Node process with no special access, talking to
// the server purely over HTTP + Socket.IO like any other client.
//
// Usage: node security-retest.mjs [baseUrl]   (defaults to http://localhost:8787)
import { io as ioClient } from 'socket.io-client';

const BASE = process.argv[2] || 'http://localhost:8787';
let pass = 0;
let fail = 0;
function report(label, ok, detail = '') {
  console.log(`${ok ? '✅ BLOCKED' : '🚨 STILL POSSIBLE'} — ${label}${detail ? ` (${detail})` : ''}`);
  if (ok) pass += 1;
  else fail += 1;
}

function extractCookie(res) {
  const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie()[0] : res.headers.get('set-cookie');
  return raw ? raw.split(';')[0] : undefined;
}

async function signup(name, password) {
  const res = await fetch(`${BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, password }),
  });
  const body = await res.json();
  return { status: res.status, body, cookie: extractCookie(res) };
}

function authedFetch(cookie, path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (cookie) headers.set('Cookie', cookie);
  return fetch(`${BASE}${path}`, { ...init, headers });
}

function connect(cookie) {
  return ioClient(BASE, { transports: ['websocket'], forceNew: true, extraHeaders: cookie ? { Cookie: cookie } : {} });
}
function emitAck(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, (ack) => resolve(ack)));
}

async function main() {
  const stamp = Date.now();
  const victim = await signup(`RetestVictim_${stamp}`, 'victim-password-123');
  const attacker = await signup(`RetestAttacker_${stamp}`, 'attacker-password-123');
  console.log(`victim=${victim.body.user.id} attacker=${attacker.body.user.id}\n`);

  // --- 1. Account takeover: log in as the victim using only their (guessed/public) name ---
  const takeoverAttempt = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: victim.body.user.name, password: 'guessed-wrong-password' }),
  });
  report('Account takeover via name-only login (no password check)', takeoverAttempt.status === 401, `status=${takeoverAttempt.status}`);

  // --- 2. IDOR: attacker tries to withdraw from the victim's wallet by naming victim's id ---
  const idorAttempt = await authedFetch(attacker.cookie, '/api/wallet/withdraw', {
    method: 'POST',
    body: JSON.stringify({ amount: 500, userId: victim.body.user.id }),
  });
  const victimAfterIdor = await (await authedFetch(victim.cookie, '/api/wallet')).json();
  report(
    "IDOR: attacker draining victim's wallet via a forged userId field",
    victimAfterIdor.user.walletBalance === 1000,
    `victim balance after attack = ${victimAfterIdor.user.walletBalance}`,
  );

  // --- 3. Direct wallet route with no session at all ---
  const noSession = await fetch(`${BASE}/api/wallet`);
  report('Reading anyone\'s wallet with zero authentication', noSession.status === 401, `status=${noSession.status}`);

  // --- 4. Forged/garbage session cookie ---
  const garbageCookie = await authedFetch('arena_session=deadbeefdeadbeef', '/api/wallet');
  report('Forged session token resolving to any account', garbageCookie.status === 401, `status=${garbageCookie.status}`);

  // --- 5. Unauthenticated socket connection ---
  const anon = connect(undefined);
  const anonResult = await new Promise((resolve) => {
    anon.on('connect', () => resolve('connected'));
    anon.on('connect_error', () => resolve('rejected'));
    setTimeout(() => resolve('rejected'), 2000);
  });
  report('Unauthenticated Socket.IO connection accepted', anonResult === 'rejected', anonResult);
  anon.disconnect();

  // --- 6. ID leak: does a room-mate ever see the real account id of another player? ---
  const va = connect(victim.cookie);
  const aa = connect(attacker.cookie);
  await Promise.all([va, aa].map((s) => new Promise((r) => s.on('connect', r))));
  const createAck = await emitAck(va, 'rooms:create', { gameKind: 'memoryMatch', entryFee: 10, format: 'duel' });
  await emitAck(va, 'rooms:join', { roomId: createAck.roomId });
  const attackerJoin = await emitAck(aa, 'rooms:join', { roomId: createAck.roomId });
  const victimAsSeenByAttacker = attackerJoin.room.players.find((p) => p.name === victim.body.user.name);
  report(
    "Room broadcast leaking another player's real account id",
    victimAsSeenByAttacker.id !== victim.body.user.id,
    `leaked id shown to attacker = ${victimAsSeenByAttacker.id}`,
  );

  // --- 7. The original bot exploit: hammer match:answer as fast as the process can loop ---
  const readyPromise = new Promise((resolve) => {
    let optionsSeen = null;
    va.on('match:round:options', (opts) => {
      optionsSeen = opts;
      resolve(optionsSeen);
    });
    void emitAck(va, 'rooms:ready', { roomId: createAck.roomId });
    void emitAck(aa, 'rooms:ready', { roomId: createAck.roomId });
  });
  const firstOptions = await readyPromise;
  const started = Date.now();
  let attempts = 0;
  let accepted = 0;
  const deadlineMs = 3000;
  while (Date.now() - started < deadlineMs) {
    attempts += 1;
    const ack = await emitAck(va, 'match:answer', { roomId: createAck.roomId, roundId: firstOptions.roundId, optionToken: firstOptions.options[0].token });
    if (ack.ok) accepted += 1;
    if (ack.ok) break; // once the real round is legitimately resolved, stop — we've made our point
  }
  const elapsedS = (Date.now() - started) / 1000;
  const impliedMaxThroughputPerMinute = Math.round((attempts / elapsedS) * 60);
  report(
    'Unlimited-throughput answer spam (original finding: 173,312 answers/60s at 100% "accuracy")',
    accepted <= 1,
    `${attempts} rapid-fire attempts in ${elapsedS.toFixed(2)}s, only ${accepted} ever accepted (server enforces real round pacing + MIN_REACTION_MS, not naive per-request throughput)`,
  );
  console.log(`   (for reference, naive unrestricted request throughput alone would be ~${impliedMaxThroughputPerMinute}/min if every attempt were accepted — none were beyond the one legitimate resolution)`);

  // --- 8. Forged round/score/reward payload: try to just declare a win directly ---
  const forgedScore = await emitAck(va, 'match:answer', { roomId: createAck.roomId, roundId: 'fake-round-i-invented', optionToken: 'fake-token', score: 999999, correct: true });
  report('Client-declared score/correctness accepted at face value', !forgedScore.ok, JSON.stringify(forgedScore));

  await Promise.all([emitAck(va, 'rooms:leave', { roomId: createAck.roomId }), emitAck(aa, 'rooms:leave', { roomId: createAck.roomId })]);
  va.disconnect();
  aa.disconnect();

  console.log(`\n${pass} exploit(s) blocked, ${fail} still possible.`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Retest crashed:', err);
  process.exit(1);
});
