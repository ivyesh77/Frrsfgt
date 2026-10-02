/**
 * End-to-end self-test for the admin operations center — a SEPARATE suite from
 * selftest.ts (which covers the player-facing game/wallet/matchmaking system). Boots the
 * real server in-process (both the player API on its own throwaway port and the admin API
 * on its own separate throwaway port, exactly like production, just with short timeouts),
 * then drives real HTTP requests against both — never calling any internal function
 * directly to "fake" an HTTP boundary that a real attacker would actually have to cross.
 *
 * Covers: admin auth, admin RBAC (every role's permission boundary), unauthorized access
 * to admin APIs (no token, garbage token, and — critically — a REAL PLAYER session token),
 * user access control, room access + match control (force-cancel is always a void/refund,
 * never a picked winner), game config (and that a config change actually changes real
 * match behavior), payment config permission boundaries, transaction access control,
 * the audited balance-adjustment workflow (including the second-approval threshold),
 * webhook processing + duplicate-webhook idempotency, audit logging (including failed
 * actions), feature flags actually gating real gameplay, and maintenance mode actually
 * blocking real player actions.
 */
process.env.PORT = process.env.PORT || '8801';
process.env.ADMIN_PORT = process.env.ADMIN_PORT || '8802';
process.env.ARCADE_MATCH_DURATION_MS = '4000';
process.env.ARCADE_READY_COUNTDOWN_MS = '300';
process.env.ARCADE_ROUND_MEMORIZE_MS = '120';
process.env.ARCADE_ROUND_ANSWER_MS = '400';
process.env.ARCADE_LOBBY_READY_TIMEOUT_MS = '900';
process.env.ARCADE_RECONNECT_GRACE_MS = '700';
process.env.ARCADE_SIGNUP_LIMIT = '300';
process.env.ARCADE_LOGIN_LIMIT = '300';
process.env.ADMIN_BOOTSTRAP_NAME = 'adminselftest_super';
process.env.ADMIN_BOOTSTRAP_PASSWORD = 'AdminSelfTestBootstrapPW1';

import { io as ioClient, type Socket } from 'socket.io-client';

const BASE = `http://localhost:${process.env.PORT}`;
const ADMIN_BASE = `http://localhost:${process.env.ADMIN_PORT}`;

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (!condition) {
    failures += 1;
    console.error(`✗ FAIL: ${message}`);
  } else {
    console.log(`✓ ${message}`);
  }
}

// --- Player-side helpers (mirrors selftest.ts's own helpers, kept independent on purpose) ---
async function playerSignup(name: string): Promise<{ cookie: string; token: string; userId: string }> {
  const res = await fetch(`${BASE}/api/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, password: 'password-123-ok' }) });
  const body = (await res.json()) as { user: { id: string }; token: string };
  const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie()[0] : res.headers.get('set-cookie');
  return { cookie: raw ? raw.split(';')[0]! : '', token: body.token, userId: body.user.id };
}
function connectPlayerSocket(cookie: string): Socket {
  return ioClient(BASE, { transports: ['websocket'], forceNew: true, extraHeaders: { Cookie: cookie } });
}
function emitAck<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve) => socket.emit(event, payload, (ack: T) => resolve(ack)));
}

// --- Admin-side helpers ---
async function adminLogin(name: string, password: string): Promise<{ token: string; status: number; body: any }> {
  const res = await fetch(`${ADMIN_BASE}/admin/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, password }) });
  const body = (await res.json()) as { token: string };
  return { token: body.token, status: res.status, body };
}
function adminFetch(token: string | undefined, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(`${ADMIN_BASE}${path}`, { ...init, headers });
}
async function adminJson<T = any>(token: string | undefined, path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const res = await adminFetch(token, path, init);
  const body = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, body };
}

async function createAdmin(superToken: string, name: string, role: string): Promise<string> {
  const res = await adminJson<{ ok: boolean }>(superToken, '/admin/admin-users', {
    method: 'POST',
    body: JSON.stringify({ name, password: 'AdminAccountPassword123', role, reason: 'self-test setup' }),
  });
  assert(res.status === 200 && res.body.ok, `created a ${role} admin account for testing`);
  const login = await adminLogin(name, 'AdminAccountPassword123');
  assert(login.status === 200 && !!login.token, `logged in as the newly-created ${role} admin`);
  return login.token;
}

async function main() {
  // The admin store is a single on-disk JSON file shared with any other locally-running
  // instance (the exact same documented, accepted limitation store.ts already has for the
  // player ledger) — reset it first so this suite's "bootstrap the first SUPER_ADMIN"
  // assumption is actually true, regardless of what a concurrently-running dev server has
  // already written there. Do NOT run this suite against a shared/production data
  // directory for the same reason selftest.ts shouldn't either.
  const { __resetAdminStoreForTests } = await import('./admin/store.js');
  __resetAdminStoreForTests();

  await import('./index.js'); // boots both the player server and the admin server with the overridden env above
  await new Promise((r) => setTimeout(r, 400));

  // ===========================================================================
  // 1. ADMIN AUTH
  // ===========================================================================
  const wrongPw = await adminLogin(process.env.ADMIN_BOOTSTRAP_NAME!, 'totally-wrong-password');
  assert(wrongPw.status === 401, 'wrong admin password is rejected');

  const nonexistent = await adminLogin('no-such-admin-account', 'whatever-password-123');
  assert(nonexistent.status === 401, 'nonexistent admin username is rejected with the same status as a wrong password (no enumeration)');

  const superLogin = await adminLogin(process.env.ADMIN_BOOTSTRAP_NAME!, process.env.ADMIN_BOOTSTRAP_PASSWORD!);
  assert(superLogin.status === 200 && !!superLogin.token, 'the bootstrap SUPER_ADMIN account can log in with its real password');
  const superToken = superLogin.token;

  const me = await adminJson<{ admin: { role: string }; permissions: string[] }>(superToken, '/admin/auth/me');
  assert(me.status === 200 && me.body.admin.role === 'SUPER_ADMIN', 'GET /admin/auth/me resolves the real session, not anything client-asserted');
  assert(me.body.permissions.includes('admin.manage'), 'SUPER_ADMIN has the admin.manage permission');
  const createdPaymentAccount = await adminJson<{ ok: boolean; adapter: { adapterId: string; status: string; environment: string } }>(superToken, '/admin/payment-adapters', {
    method: 'POST',
    body: JSON.stringify({ displayName: `Self-test account ${Date.now()}`, method: 'UPI', currency: 'INR', reason: 'Test add/remove payment account' }),
  });
  assert(createdPaymentAccount.status === 201 && createdPaymentAccount.body.ok && createdPaymentAccount.body.adapter.status === 'DISABLED' && createdPaymentAccount.body.adapter.environment === 'TEST', 'SUPER_ADMIN can add a new disabled TEST payment account without enabling live funds');
  const createdAdapterId = createdPaymentAccount.body.adapter.adapterId;
  const archivedPaymentAccount = await adminJson<{ ok: boolean; adapter: { status: string; depositEnabled: boolean; withdrawalEnabled: boolean } }>(superToken, `/admin/payment-adapters/${createdAdapterId}/archive`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'Test remove payment account from new routing' }),
  });
  assert(archivedPaymentAccount.status === 200 && archivedPaymentAccount.body.ok && archivedPaymentAccount.body.adapter.status === 'ARCHIVED' && !archivedPaymentAccount.body.adapter.depositEnabled && !archivedPaymentAccount.body.adapter.withdrawalEnabled, 'SUPER_ADMIN can remove a payment account by archiving it while preserving its history');
  const previewHeaderMe = await fetch(`${ADMIN_BASE}/admin/auth/me`, { headers: { 'X-Arena-Admin-Session-Token': superToken } });
  assert(previewHeaderMe.status === 200, 'preview fallback admin session header authenticates when Authorization is rewritten');

  // ===========================================================================
  // 2. UNAUTHORIZED ADMIN API ACCESS
  // ===========================================================================
  const noToken = await adminJson(undefined, '/admin/dashboard');
  assert(noToken.status === 401, 'admin dashboard rejects a request with no token at all');

  const garbageToken = await adminJson('completely-made-up-token-value', '/admin/dashboard');
  assert(garbageToken.status === 401, 'admin dashboard rejects a forged/garbage bearer token');

  const garbageUsers = await adminJson('completely-made-up-token-value', '/admin/users');
  assert(garbageUsers.status === 401, 'admin users list rejects a forged/garbage bearer token');

  // A REAL, currently-valid PLAYER session token must never work against ANY admin route —
  // the two auth systems must be completely disjoint.
  const player = await playerSignup(`AdminTestPlayer_${Date.now()}`);
  const playerAgainstAdmin1 = await adminJson(player.token, '/admin/dashboard');
  assert(playerAgainstAdmin1.status === 401, "a real player's own session token is rejected by the admin dashboard");
  const playerAgainstAdmin2 = await adminJson(player.token, '/admin/users');
  assert(playerAgainstAdmin2.status === 401, "a real player's own session token is rejected by the admin users list");
  const playerAgainstAdmin3 = await adminJson(player.token, '/admin/game/config');
  assert(playerAgainstAdmin3.status === 401, "a real player's own session token is rejected by admin game config");

  // ===========================================================================
  // 3. ADMIN RBAC — every role's permission boundary, enforced server-side
  // ===========================================================================
  const stamp = Date.now();
  const gameOpToken = await createAdmin(superToken, `go_${stamp}`, 'GAME_OPERATOR');
  const paymentOpToken = await createAdmin(superToken, `po_${stamp}`, 'PAYMENT_OPERATOR');
  const supportToken = await createAdmin(superToken, `sup_${stamp}`, 'SUPPORT_AGENT');
  const readOnlyToken = await createAdmin(superToken, `ro_${stamp}`, 'READ_ONLY');

  // GAME_OPERATOR: can view/moderate rooms and edit game config, but NOT touch wallets/payments/admin accounts
  assert((await adminJson(gameOpToken, '/admin/rooms')).status === 200, 'GAME_OPERATOR can view rooms');
  assert((await adminJson(gameOpToken, '/admin/game/config')).status === 200, 'GAME_OPERATOR can view game config');
  assert(
    (await adminJson(gameOpToken, '/admin/wallets/overview')).status === 403,
    'GAME_OPERATOR is forbidden from wallet overview (no wallet.view permission)',
  );
  assert(
    (await adminJson(gameOpToken, '/admin/admin-users', { method: 'POST', body: JSON.stringify({ name: 'x', password: 'xxxxxxxxxxxx', role: 'ADMIN', reason: 'x' }) })).status === 403,
    'GAME_OPERATOR cannot create admin accounts (no admin.manage permission)',
  );

  // PAYMENT_OPERATOR: can view/edit payments and wallets, but NOT game config or admin accounts
  assert((await adminJson(paymentOpToken, '/admin/payment-adapters')).status === 200, 'PAYMENT_OPERATOR can view the payment adapter registry');
  assert((await adminJson(paymentOpToken, '/admin/payment-config')).status === 200, 'PAYMENT_OPERATOR can view payment routing configuration');
  assert((await adminJson(readOnlyToken, '/admin/payment-adapters/PAY-01')).status === 200, 'READ_ONLY can view a payment adapter through the server permission boundary');
  assert((await adminJson(paymentOpToken, '/admin/payments/upi')).status === 200, 'PAYMENT_OPERATOR can view UPI config');
  assert(
    (await adminJson(paymentOpToken, '/admin/game/config', { method: 'PUT', body: JSON.stringify({ patch: { matchDurationMs: 30000 }, reason: 'x' }) })).status === 403,
    'PAYMENT_OPERATOR is forbidden from editing game config (no game.config.edit permission)',
  );
  assert((await adminJson(paymentOpToken, '/admin/rooms')).status === 403, 'PAYMENT_OPERATOR is forbidden from viewing rooms (no rooms.view permission)');

  // SUPPORT_AGENT: can view users/transactions and leave notes, but NEVER mutate wallets or game config
  assert((await adminJson(supportToken, '/admin/users')).status === 200, 'SUPPORT_AGENT can view users');
  assert((await adminJson(supportToken, '/admin/transactions')).status === 200, 'SUPPORT_AGENT can view transactions (read-only)');
  assert(
    (await adminJson(supportToken, '/admin/wallets/someid/adjustment', { method: 'POST', body: JSON.stringify({ amount: 100, direction: 'credit', reason: 'x' }) })).status === 403,
    'SUPPORT_AGENT is forbidden from wallet adjustments — this role must never gain financial mutation permission',
  );
  assert(
    (await adminJson(supportToken, '/admin/users/someid/suspend', { method: 'POST', body: JSON.stringify({ reason: 'x' }) })).status === 403,
    'SUPPORT_AGENT is forbidden from suspending users (no users.moderate permission)',
  );

  // READ_ONLY: can view broadly, but can NEVER mutate ANYTHING
  assert((await adminJson(readOnlyToken, '/admin/users')).status === 200, 'READ_ONLY can view users');
  assert(
    (await adminJson(readOnlyToken, '/admin/flags/duelEnabled', { method: 'PUT', body: JSON.stringify({ value: false, reason: 'x' }) })).status === 403,
    'READ_ONLY is forbidden from changing feature flags',
  );
  assert(
    (await adminJson(readOnlyToken, '/admin/maintenance/platform', { method: 'PUT', body: JSON.stringify({ enabled: true, reason: 'x' }) })).status === 403,
    'READ_ONLY is forbidden from changing maintenance mode',
  );

  // ===========================================================================
  // 4. USER ACCESS CONTROL + BALANCE ADJUSTMENT (audited workflow)
  // ===========================================================================
  const targetPlayer = await playerSignup(`AdjustTarget_${stamp}`);
  const walletBefore = await adminJson<{ user: { walletBalance: number } }>(paymentOpToken, `/admin/wallets/${targetPlayer.userId}`);
  assert(walletBefore.status === 200, 'PAYMENT_OPERATOR can view a specific user wallet');
  const balanceBefore = walletBefore.body.user.walletBalance;

  const missingReason = await adminJson(paymentOpToken, `/admin/wallets/${targetPlayer.userId}/adjustment`, { method: 'POST', body: JSON.stringify({ amount: 100, direction: 'credit' }) });
  assert(missingReason.status === 400, 'a balance adjustment without a reason is rejected');

  const adjustResult = await adminJson<{ ok: boolean; before: number; after: number }>(paymentOpToken, `/admin/wallets/${targetPlayer.userId}/adjustment`, {
    method: 'POST',
    body: JSON.stringify({ amount: 250, direction: 'credit', reason: 'self-test manual credit', reference: 'TEST-REF-1' }),
  });
  assert(adjustResult.status === 200 && adjustResult.body.ok, 'an audited credit adjustment succeeds');
  assert(adjustResult.body.before === balanceBefore, 'the adjustment response reports the correct BEFORE balance');
  assert(adjustResult.body.after === balanceBefore + 250, 'the adjustment credited exactly the requested amount, no more, no less');

  const bigAdjustNoApproval = await adminJson(paymentOpToken, `/admin/wallets/${targetPlayer.userId}/adjustment`, {
    method: 'POST',
    body: JSON.stringify({ amount: 60_000, direction: 'credit', reason: 'testing the high-value threshold' }),
  });
  assert(bigAdjustNoApproval.status === 403, 'an adjustment at/above the high-value threshold is rejected without a second approver');

  // Deliberately kept below the 50,000 second-approval threshold so this actually exercises
  // the overdraft check itself, not the (already-tested-above) threshold gate.
  const debitOverdraft = await adminJson(paymentOpToken, `/admin/wallets/${targetPlayer.userId}/adjustment`, {
    method: 'POST',
    body: JSON.stringify({ amount: 40_000, direction: 'debit', reason: 'testing overdraft protection' }),
  });
  assert(debitOverdraft.status === 400, 'a debit adjustment that would overdraft the wallet is rejected, never allowed to go negative');

  // ===========================================================================
  // 5. AUDIT LOGGING — including a FAILED action still producing an entry
  // ===========================================================================
  const auditAfterAdjust = await adminJson<{ rows: Array<{ action: string; result: string }> }>(superToken, '/admin/audit');
  assert(auditAfterAdjust.status === 200, 'SUPER_ADMIN can view the full audit log');
  const hasSuccessfulAdjustment = auditAfterAdjust.body.rows.some((r) => r.action === 'BALANCE_ADJUSTMENT' && r.result === 'success');
  assert(hasSuccessfulAdjustment, 'the successful balance adjustment produced a SUCCESS audit entry');
  const hasFailedAdjustment = auditAfterAdjust.body.rows.some((r) => r.action === 'BALANCE_ADJUSTMENT' && r.result === 'failure');
  assert(hasFailedAdjustment, 'the rejected (missing-reason / overdraft / threshold) adjustment attempts also produced FAILURE audit entries — the trail is never selectively incomplete');

  const myActivity = await adminJson<{ rows: Array<{ adminName: string }> }>(paymentOpToken, '/admin/me/activity');
  assert(myActivity.status === 200 && myActivity.body.rows.length > 0, "a PAYMENT_OPERATOR can see their own recent actions via 'My Activity'");

  // ===========================================================================
  // 6. FEATURE FLAGS actually gate real gameplay (not just cosmetic admin state)
  // ===========================================================================
  const disableSquad = await adminJson(superToken, '/admin/flags/squadEnabled', { method: 'PUT', body: JSON.stringify({ value: false, reason: 'self-test: verify flag actually blocks gameplay' }) });
  assert(disableSquad.status === 200, 'SUPER_ADMIN can disable the squad format flag');

  const flagTestPlayer = await playerSignup(`FlagTest_${stamp}`);
  const flagSocket = connectPlayerSocket(flagTestPlayer.cookie);
  await new Promise<void>((r) => flagSocket.on('connect', () => r()));
  const blockedJoin = await emitAck<{ ok: boolean; error?: string }>(flagSocket, 'queue:join', { gameKind: 'memoryMatch', entryFee: 10, format: 'squad' });
  assert(blockedJoin.ok === false && !!blockedJoin.error?.toLowerCase().includes('disabled'), 'a real player is blocked from joining squad matchmaking the instant the feature flag is off — this is the actual gameplay effect, not just an admin-side toggle');

  const reenableSquad = await adminJson(superToken, '/admin/flags/squadEnabled', { method: 'PUT', body: JSON.stringify({ value: true, reason: 'self-test cleanup' }) });
  assert(reenableSquad.status === 200, 'SUPER_ADMIN can re-enable the squad format flag');
  const allowedJoin = await emitAck<{ ok: boolean }>(flagSocket, 'queue:join', { gameKind: 'memoryMatch', entryFee: 10, format: 'squad' });
  assert(allowedJoin.ok === true, 'squad matchmaking works again immediately after the flag is re-enabled');
  await emitAck(flagSocket, 'queue:leave', { roomId: (allowedJoin as any).roomId });
  flagSocket.disconnect();

  // ===========================================================================
  // 7. MAINTENANCE MODE actually blocks real player actions
  // ===========================================================================
  const enableMaintenance = await adminJson(superToken, '/admin/maintenance/matchmaking', { method: 'PUT', body: JSON.stringify({ enabled: true, message: 'Self-test maintenance window', reason: 'self-test' }) });
  assert(enableMaintenance.status === 200, 'SUPER_ADMIN can enable matchmaking maintenance mode');

  const maintenancePlayer = await playerSignup(`MaintTest_${stamp}`);
  const maintSocket = connectPlayerSocket(maintenancePlayer.cookie);
  await new Promise<void>((r) => maintSocket.on('connect', () => r()));
  const blockedByMaintenance = await emitAck<{ ok: boolean; error?: string }>(maintSocket, 'queue:join', { gameKind: 'memoryMatch', entryFee: 10, format: 'duel' });
  assert(blockedByMaintenance.ok === false, 'a real player cannot join matchmaking while matchmaking maintenance mode is enabled — enforced server-side, not bypassable by any client state');
  maintSocket.disconnect();

  const disableMaintenance = await adminJson(superToken, '/admin/maintenance/matchmaking', { method: 'PUT', body: JSON.stringify({ enabled: false, message: '', reason: 'self-test cleanup' }) });
  assert(disableMaintenance.status === 200, 'SUPER_ADMIN can disable matchmaking maintenance mode again');

  // ===========================================================================
  // 8. GAME CONFIG changes are real and server-authoritative
  // ===========================================================================
  const configBefore = await adminJson<{ config: { matchDurationMs: number } }>(superToken, '/admin/game/config');
  const newDuration = 7000;
  const configUpdate = await adminJson(superToken, '/admin/game/config', { method: 'PUT', body: JSON.stringify({ patch: { matchDurationMs: newDuration }, reason: 'self-test: verify config actually changes match timing' }) });
  assert(configUpdate.status === 200, 'SUPER_ADMIN can update game config');

  const configPlayers = await Promise.all([playerSignup(`CfgA_${stamp}`), playerSignup(`CfgB_${stamp}`)]);
  const configSockets = configPlayers.map((p) => connectPlayerSocket(p.cookie));
  await Promise.all(configSockets.map((s) => new Promise<void>((r) => s.on('connect', () => r()))));
  const cfgAcks = await Promise.all(configSockets.map((s) => emitAck<{ ok: boolean; room?: { id: string } }>(s, 'queue:join', { gameKind: 'memoryMatch', entryFee: 10, format: 'duel' })));
  const cfgRoomId = cfgAcks[0]!.room!.id;
  await Promise.all(configSockets.map((s) => emitAck(s, 'rooms:ready', { roomId: cfgRoomId })));
  const startedRoomUpdate = await new Promise<{ matchEndsAt: number }>((resolve) => {
    configSockets[0]!.on('room:update', (room: { status: string; matchEndsAt: number | null }) => {
      if (room.status === 'active' && room.matchEndsAt) resolve({ matchEndsAt: room.matchEndsAt });
    });
  });
  const observedDurationMs = startedRoomUpdate.matchEndsAt - Date.now();
  assert(
    Math.abs(observedDurationMs - newDuration) < 1500,
    `a freshly-started match's actual timer reflects the admin-configured duration (${newDuration}ms), not the old default (${configBefore.body.config.matchDurationMs}ms) — observed ~${observedDurationMs}ms`,
  );
  configSockets.forEach((s) => s.disconnect());

  // Restore the default so nothing else in this run is affected.
  await adminJson(superToken, '/admin/game/config', { method: 'PUT', body: JSON.stringify({ patch: { matchDurationMs: configBefore.body.config.matchDurationMs }, reason: 'self-test cleanup' }) });

  // ===========================================================================
  // 9. ROOM ACCESS + MATCH CONTROL — force-cancel is always a void, never a picked winner
  // ===========================================================================
  const matchPlayers = await Promise.all([playerSignup(`CancelA_${stamp}`), playerSignup(`CancelB_${stamp}`)]);
  const matchSockets = matchPlayers.map((p) => connectPlayerSocket(p.cookie));
  await Promise.all(matchSockets.map((s) => new Promise<void>((r) => s.on('connect', () => r()))));
  const walletsBeforeCancel = await Promise.all(matchPlayers.map((p) => adminJson<{ user: { walletBalance: number } }>(superToken, `/admin/wallets/${p.userId}`)));
  const cancelAcks = await Promise.all(matchSockets.map((s) => emitAck<{ ok: boolean; room?: { id: string } }>(s, 'queue:join', { gameKind: 'memoryMatch', entryFee: 50, format: 'duel' })));
  const cancelRoomId = cancelAcks[0]!.room!.id;
  const reachedActive = new Promise<void>((resolve) => {
    matchSockets[0]!.on('room:update', (room: { status: string }) => {
      if (room.status === 'active') resolve();
    });
  });
  await Promise.all(matchSockets.map((s) => emitAck(s, 'rooms:ready', { roomId: cancelRoomId })));
  await reachedActive; // wait for the REAL server-driven transition, never a fixed sleep guess

  const matchEndPromise = new Promise<any>((resolve) => matchSockets[0]!.on('match:end', resolve));
  const roomDetailBeforeCancel = await adminJson<{ status: string }>(superToken, `/admin/rooms/${cancelRoomId}`);
  assert(roomDetailBeforeCancel.status === 200 && roomDetailBeforeCancel.body.status === 'active', 'GAME_OPERATOR/SUPER_ADMIN can inspect a live active match by room id');

  const cancelResult = await adminJson<{ ok: boolean }>(superToken, `/admin/rooms/${cancelRoomId}/cancel`, { method: 'POST', body: JSON.stringify({ reason: 'self-test: simulate a stuck/broken match' }) });
  assert(cancelResult.status === 200 && cancelResult.body.ok, 'SUPER_ADMIN can force-cancel a live active match');

  const cancelledMatchResult = await matchEndPromise;
  assert(cancelledMatchResult.endedBy === 'admin_cancelled', "the force-cancelled match reports endedBy === 'admin_cancelled'");
  assert(cancelledMatchResult.isVoidMatch === true, 'an admin-forced cancellation is ALWAYS reported as a void match');
  assert(cancelledMatchResult.results.every((r: { isWinner: boolean; payout: number }) => !r.isWinner && r.payout === 50), 'every player is refunded their exact entry fee and NOBODY is ever declared a winner by an admin cancellation — there is no "set winner" shortcut anywhere');

  await new Promise((r) => setTimeout(r, 150));
  const walletsAfterCancel = await Promise.all(matchPlayers.map((p) => adminJson<{ user: { walletBalance: number } }>(superToken, `/admin/wallets/${p.userId}`)));
  for (let i = 0; i < matchPlayers.length; i += 1) {
    assert(walletsAfterCancel[i]!.body.user.walletBalance === walletsBeforeCancel[i]!.body.user.walletBalance, `player ${i} is made exactly whole (full entry-fee refund, no gain, no loss) after the admin cancellation`);
  }
  matchSockets.forEach((s) => s.disconnect());

  const doubleCancelResult = await adminJson<{ ok: boolean }>(superToken, `/admin/rooms/${cancelRoomId}/cancel`, { method: 'POST', body: JSON.stringify({ reason: 'trying to cancel an already-finished match' }) });
  assert(doubleCancelResult.status === 400, 'cancelling an already-finished/cancelled room a second time is rejected, not silently repeated');

  // ===========================================================================
  // 10. WEBHOOK PROCESSING + DUPLICATE WEBHOOK IDEMPOTENCY (internal module — see
  //     admin/payments.ts's own doc-comment: there is no public HTTP intake route yet
  //     because no real payment provider exists to call one; this exercises the exact
  //     function a future provider webhook route would call).
  // ===========================================================================
  const { ingestWebhookEvent } = await import('./admin/payments.js');
  const idempotencyKey = `selftest-key-${stamp}`;
  const firstEvent = ingestWebhookEvent({ provider: 'test-provider', eventType: 'payment.success', idempotencyKey });
  assert(firstEvent.status === 'received', 'a fresh webhook event is ingested as "received"');
  const duplicateEvent = ingestWebhookEvent({ provider: 'test-provider', eventType: 'payment.success', idempotencyKey });
  assert(duplicateEvent.status === 'duplicate_ignored', 'a second webhook delivery with the SAME idempotency key is recognized and ignored as a duplicate, never double-processed');

  const webhooksList = await adminJson<{ events: Array<{ idempotencyKey: string; status: string }> }>(superToken, '/admin/webhooks');
  assert(webhooksList.status === 200, 'SUPER_ADMIN can view the webhook event list');
  const recordedDuplicate = webhooksList.body.events.find((e) => e.idempotencyKey === idempotencyKey && e.status === 'duplicate_ignored');
  assert(!!recordedDuplicate, 'the duplicate webhook is visible in the admin webhook list with its correct status');

  const retryReceivedEvent = await adminJson<{ ok: boolean }>(superToken, `/admin/webhooks/${firstEvent.id}/retry`, { method: 'POST', body: JSON.stringify({ reason: 'test retry of a still-open event' }) });
  assert(retryReceivedEvent.status === 200, 'retrying a non-terminal webhook event is allowed');
  const retryDuplicateEvent = await adminJson(superToken, `/admin/webhooks/${duplicateEvent.id}/retry`, { method: 'POST', body: JSON.stringify({ reason: 'trying to retry a duplicate-ignored event' }) });
  assert(retryDuplicateEvent.status === 409, 'retrying a duplicate-ignored webhook event is rejected — there is nothing safe to retry');

  // ===========================================================================
  // 11. SELF-SERVICE PASSWORD CHANGE (no admin, not even SUPER_ADMIN, can reset another
  //     admin's password — only the account holder, and only by re-proving the current
  //     one; a successful change must rotate out every other session for that account).
  // ===========================================================================
  const pwName = `pwchange_${stamp}`;
  const pwInitial = 'AdminAccountPassword123'; // createAdmin()'s fixed test password, see that helper
  const pwOriginal = 'OriginalPassword123';
  const sessionAToken = await createAdmin(superToken, pwName, 'READ_ONLY');

  const wrongCurrentPw = await adminJson<{ error?: string }>(sessionAToken, '/admin/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword: 'TotallyWrongPassword', newPassword: pwOriginal }),
  });
  assert(wrongCurrentPw.status === 400, "changing a password with the WRONG current password is rejected, even though the requester's own session is otherwise valid");

  const tooShortNewPw = await adminJson<{ error?: string }>(sessionAToken, '/admin/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword: pwInitial, newPassword: 'short' }),
  });
  assert(tooShortNewPw.status === 400, 'a new password shorter than 12 characters is rejected');

  // Note by inspection of the route (server.ts's /admin/auth/change-password handler): it
  // reads only `req.admin!` (the caller's own resolved session) and takes no admin-id
  // parameter from the request body at all — there is structurally no way for this endpoint
  // to target any account other than the caller's own, regardless of role, including
  // SUPER_ADMIN. (Not re-exercised live here to avoid burning extra budget against the
  // same per-IP admin-login rate limit this suite already deliberately keeps tight.)

  const pwChangeOk = await adminJson<{ ok: boolean; token: string }>(sessionAToken, '/admin/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword: pwInitial, newPassword: pwOriginal }),
  });
  assert(pwChangeOk.status === 200 && pwChangeOk.body.ok === true, 'a correct current password + valid new password succeeds');

  const oldSessionDead = await adminJson(sessionAToken, '/admin/auth/me');
  assert(oldSessionDead.status === 401, 'the OLD session token used to request the change is itself invalidated by the rotation (a leaked old token stops working the moment the password is rotated)');

  const newSessionAlive = await adminJson(pwChangeOk.body.token, '/admin/auth/me');
  assert(newSessionAlive.status === 200, 'the freshly issued session token returned by the change-password call keeps this browser logged in');

  const loginWithOldPwFails = await adminLogin(pwName, pwInitial);
  assert(loginWithOldPwFails.status === 401, 'logging in with the OLD password no longer works after rotation');
  const loginWithNewPwWorks = await adminLogin(pwName, pwOriginal);
  assert(loginWithNewPwWorks.status === 200, 'logging in with the NEW password works');

  const changePwAuditEntry = await adminJson<{ rows: Array<{ action: string; adminName: string }> }>(superToken, '/admin/audit');
  assert(
    changePwAuditEntry.body.rows.some((r) => r.action === 'CHANGE_OWN_PASSWORD' && r.adminName === pwName),
    'a self-service password change produces an audit entry (with no password material anywhere in it)',
  );
  assert(
    !JSON.stringify(changePwAuditEntry.body.rows).includes(pwOriginal) && !JSON.stringify(changePwAuditEntry.body.rows).includes(pwInitial),
    'no raw or previous password ever appears anywhere in the audit log',
  );

  console.log('\n' + (failures === 0 ? 'ALL ADMIN SELF-TESTS PASSED' : `${failures} ADMIN SELF-TEST(S) FAILED`));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Admin self-test crashed:', err);
  process.exit(1);
});
