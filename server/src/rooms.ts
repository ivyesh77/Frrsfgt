import { nanoid } from 'nanoid';
import type { Server } from 'socket.io';
import { generateRound } from './gameKinds/index.js';
import { newRoundToken } from './gameKinds/shared.js';
import { computeMatchPayout } from './payout.js';
import { debitEntryFee, refundEntryFee, creditPayout, InsufficientFundsError } from './wallet.js';
import { recordTransaction } from './store.js';
import { recordMatch } from './admin/matchHistory.js';
import { recordEvent } from './admin/signals.js';
import { getEffectiveGameConfig } from './admin/config.js';
import {
  roomFormatMeta,
  MIN_REACTION_MS,
  type ActiveRound,
  type GameKind,
  type MatchResultPlayer,
  type MatchResultPublic,
  type PlayerConnectionState,
  type RoomFormat,
  type RoomPlayer,
  type RoomPlayerPublic,
  type RoomStatePublic,
  type RoomStatus,
  type RoomSummary,
  type RoundOptionsPublic,
  type RoundRevealPublic,
  type RoundTimeoutPublic,
  type User,
} from './types.js';

/** Thrown when a client tries to act on behalf of a room it isn't actually seated in, or
 *  answers a round it doesn't own — kept distinct from ordinary "invalid state" errors so
 *  callers can log/monitor authorization failures separately from normal gameplay errors. */
export class RoomAuthorizationError extends Error {}

class Room {
  id = nanoid(8);
  gameKind: GameKind;
  format: RoomFormat;
  maxPlayers: number;
  winnerCount: number;
  entryFee: number;
  status: RoomStatus = 'queued';
  players = new Map<string, RoomPlayer>();
  pool = 0;
  readyDeadline: number | null = null;
  startsAt: number | null = null;
  matchEndsAt: number | null = null;
  timers: NodeJS.Timeout[] = [];
  /** When this room was first created (entered the queue) — used only by the admin Rooms
   *  screen to show elapsed time; never exposed to the player client. */
  createdAt = Date.now();
  matchStartedAt: number | null = null;

  constructor(gameKind: GameKind, entryFee: number, format: RoomFormat) {
    this.gameKind = gameKind;
    this.entryFee = entryFee;
    this.format = format;
    const meta = roomFormatMeta(format);
    this.maxPlayers = meta.players;
    this.winnerCount = meta.winnerCount;
  }

  clearTimers() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    for (const player of this.players.values()) clearPlayerTimers(player);
  }
}

function clearPlayerTimers(player: RoomPlayer): void {
  if (player.activeRound) {
    if (player.activeRound.advanceTimer) clearTimeout(player.activeRound.advanceTimer);
    if (player.activeRound.expireTimer) clearTimeout(player.activeRound.expireTimer);
  }
  if (player.forfeitTimer) clearTimeout(player.forfeitTimer);
}

/** `viewerUserId` is whichever socket this payload is being sent to — every OTHER
 *  occupant's real account id is replaced with their room-scoped opaque `publicId`, so a
 *  player can never learn another player's actual account id just by sharing a room with
 *  them (see AUDIT_REPORT.md — this was a live, verified wallet-drain vector). The
 *  viewer's own entry keeps its real id so the client can tell which seat is "me". Only
 *  public gameplay fields are ever included — no socket id, no email, no wallet balance,
 *  no internal DB shape. */
function toPlayerPublic(p: RoomPlayer, viewerUserId: string): RoomPlayerPublic {
  return {
    id: p.userId === viewerUserId ? p.userId : p.publicId,
    name: p.name,
    ready: p.ready,
    score: p.score,
    connectionState: p.connectionState,
  };
}

function toRoomPublic(room: Room, viewerUserId: string): RoomStatePublic {
  return {
    id: room.id,
    gameKind: room.gameKind,
    format: room.format,
    entryFee: room.entryFee,
    status: room.status,
    pool: room.pool,
    players: [...room.players.values()].map((p) => toPlayerPublic(p, viewerUserId)),
    readyDeadline: room.readyDeadline,
    startsAt: room.startsAt,
    matchEndsAt: room.matchEndsAt,
  };
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  /** One open (still-filling) room per `gameKind:format:entryFee` key — this IS the server
   *  side matchmaking queue. A client never picks a room id; it only ever asks to join the
   *  queue for a mode, and the server alone decides which room (existing-and-open, or a
   *  freshly created one) that seats them into. */
  private openQueues = new Map<string, Room>();
  /** The one room each user is currently associated with (queued, in a lobby, or actively
   *  playing) — used to reject "already in a match" double-joins, to silently resume a
   *  dropped connection on socket reconnect without the client re-selecting anything, and
   *  to know what to re-queue for on a rematch request. */
  private activeRoomByUser = new Map<string, string>();

  constructor(private io: Server) {}

  listRooms(gameKind?: GameKind): RoomSummary[] {
    return [...this.rooms.values()]
      .filter((r) => r.status !== 'finished' && r.status !== 'cancelled' && (!gameKind || r.gameKind === gameKind))
      .map((r) => ({
        id: r.id,
        gameKind: r.gameKind,
        format: r.format,
        entryFee: r.entryFee,
        status: r.status,
        playerCount: r.players.size,
        maxPlayers: r.maxPlayers,
      }));
  }

  private hasLiveAssignment(userId: string): boolean {
    const roomId = this.activeRoomByUser.get(userId);
    if (!roomId) return false;
    const room = this.rooms.get(roomId);
    if (!room) {
      this.activeRoomByUser.delete(userId);
      return false;
    }
    return room.status !== 'finished' && room.status !== 'cancelled';
  }

  private broadcastRoom(room: Room) {
    for (const player of room.players.values()) {
      if (player.connectionState === 'forfeited') continue;
      this.io.to(player.socketId).emit('room:update', toRoomPublic(room, player.userId));
    }
  }

  private queueKey(gameKind: GameKind, format: RoomFormat, entryFee: number): string {
    return `${gameKind}:${format}:${entryFee}`;
  }

  /**
   * The ONLY way a client can enter a match. There is no client-facing "join this specific
   * room id" call anymore — the server alone decides whether an existing open room (for
   * this exact gameKind+format+entryFee) is reused or a fresh one is created, and which
   * seat the player lands in. This is what makes "joining an unauthorized match" structurally
   * impossible rather than merely checked: there is no room-id parameter for a client to
   * forge in the first place.
   */
  queueJoin(gameKind: GameKind, entryFee: number, format: RoomFormat, user: User, socketId: string): Room {
    if (this.hasLiveAssignment(user.id)) {
      throw new Error('You are already queued or in a match — leave it before joining another');
    }

    const key = this.queueKey(gameKind, format, entryFee);
    let room = this.openQueues.get(key) ?? null;
    if (!room) {
      room = new Room(gameKind, entryFee, format);
      this.rooms.set(room.id, room);
      this.openQueues.set(key, room);
    }

    debitEntryFee(user.id, room.entryFee, room.id); // throws InsufficientFundsError if short
    room.pool += room.entryFee;

    const player: RoomPlayer = {
      userId: user.id,
      publicId: nanoid(10),
      name: user.name,
      socketId,
      ready: false,
      score: 0,
      correct: 0,
      wrong: 0,
      lastAnswerAt: null,
      connectionState: 'connected',
      activeRound: null,
      forfeitTimer: null,
    };
    room.players.set(user.id, player);
    this.activeRoomByUser.set(user.id, room.id);
    recordEvent('queueJoin', user.id);

    if (room.players.size >= room.maxPlayers) {
      this.openQueues.delete(key);
      this.enterReadyCheck(room);
    } else {
      this.broadcastRoom(room);
    }
    return room;
  }

  getRoomPublic(roomId: string, viewerUserId: string): RoomStatePublic | null {
    const room = this.rooms.get(roomId);
    return room ? toRoomPublic(room, viewerUserId) : null;
  }

  /** Called once per socket the instant it (re)connects, authenticated. If this user has a
   *  live (or just-finished) room association, re-attaches this new socket to it and — if
   *  they were mid-match and had dropped — cancels their forfeit grace timer and resumes
   *  dispatching rounds to them. Returns the room they were resumed into, or null if they
   *  have no room to resume (a perfectly normal case — most connects are a fresh session). */
  reconnect(userId: string, socketId: string): Room | null {
    const roomId = this.activeRoomByUser.get(userId);
    if (!roomId) return null;
    const room = this.rooms.get(roomId);
    const player = room?.players.get(userId);
    if (!room || !player) {
      this.activeRoomByUser.delete(userId);
      return null;
    }

    player.socketId = socketId;
    if (room.status === 'finished' || room.status === 'cancelled') {
      // Let a refresh right after match-end still read the final result once, without
      // reinstating any gameplay privileges (there is nothing left to resume).
      this.io.to(socketId).emit('room:update', toRoomPublic(room, userId));
      return room;
    }

    if (player.connectionState !== 'forfeited') {
      if (player.forfeitTimer) {
        clearTimeout(player.forfeitTimer);
        player.forfeitTimer = null;
        recordEvent('reconnect', userId); // only counts a genuine reconnect-after-drop, not every ordinary fresh connect
      }
      player.connectionState = 'connected';
      if (room.status === 'active' && !player.activeRound) this.startRound(room, player);
    }
    this.broadcastRoom(room);
    return room;
  }

  /** Explicit "REMATCH" request — never creates a client-only room. The server looks up the
   *  finished/cancelled match this user was just in and, if found, runs them back through
   *  the exact same server matchmaking path (`queueJoin`) for the same game/format/stake.
   *  It is not guaranteed to reunite the same opponent(s) — this product has no persistent
   *  "invite a specific player" system — but the room/opponent assignment is, as with any
   *  other join, decided entirely server-side. */
  rematch(user: User, socketId: string): Room {
    const lastRoomId = this.activeRoomByUser.get(user.id);
    const lastRoom = lastRoomId ? this.rooms.get(lastRoomId) : undefined;
    if (!lastRoom || (lastRoom.status !== 'finished' && lastRoom.status !== 'cancelled')) {
      throw new Error('No finished match to rematch');
    }
    return this.queueJoin(lastRoom.gameKind, lastRoom.entryFee, lastRoom.format, user, socketId);
  }

  /** Every mutating call below takes `userId` as a value the caller (index.ts) has already
   *  authenticated from the session/socket — never a value read straight off the request
   *  payload. There is intentionally no "does this userId match the caller" check *here*
   *  because there is no separate caller-supplied id to check against anymore: the
   *  authenticated user IS the only user these methods ever act as. */
  leaveRoom(roomId: string, userId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(userId);
    if (!player) return;

    if (room.status === 'queued') {
      refundEntryFee(userId, room.entryFee, room.id);
      room.pool -= room.entryFee;
      room.players.delete(userId);
      this.activeRoomByUser.delete(userId);
      this.broadcastRoom(room);
      if (room.players.size === 0) {
        const key = this.queueKey(room.gameKind, room.format, room.entryFee);
        if (this.openQueues.get(key) === room) this.openQueues.delete(key);
        this.rooms.delete(room.id);
      }
    } else if (room.status === 'ready_check' || room.status === 'starting' || room.status === 'active') {
      // A voluntary quit mid-lobby-or-match is treated exactly like an unexpected
      // disconnect: no refund, a grace window in case it was a mistake, then a real
      // forfeit — never an instant, consequence-free bail-out.
      this.markDisconnected(room, player);
    }
  }

  /** Fired by index.ts's `disconnect` handler. Distinguishes "this socket dropped" from
   *  "this player already reconnected on a new socket and the old one is just cleaning up"
   *  by checking the socket id actually still matches the player's current one. */
  handleDisconnect(roomId: string, userId: string, socketId: string) {
    const room = this.rooms.get(roomId);
    const player = room?.players.get(userId);
    if (!room || !player || player.socketId !== socketId) return;

    if (room.status === 'queued') {
      this.leaveRoom(roomId, userId);
      return;
    }
    if (room.status === 'ready_check' || room.status === 'starting' || room.status === 'active') {
      this.markDisconnected(room, player);
    }
  }

  private markDisconnected(room: Room, player: RoomPlayer) {
    if (player.connectionState === 'forfeited') return;
    if (player.activeRound) {
      // Freeze — don't keep dispatching rounds to a seat nobody's watching, and don't let
      // a stale round from before the drop be answered by whatever reconnects later.
      if (player.activeRound.advanceTimer) clearTimeout(player.activeRound.advanceTimer);
      if (player.activeRound.expireTimer) clearTimeout(player.activeRound.expireTimer);
      player.activeRound = null;
    }
    player.connectionState = 'disconnected';
    this.broadcastRoom(room);

    const graceMs = getEffectiveGameConfig().reconnectGraceMs;
    player.forfeitTimer = setTimeout(() => this.forfeitPlayer(room, player), graceMs);
  }

  private forfeitPlayer(room: Room, player: RoomPlayer) {
    if (player.connectionState !== 'disconnected') return; // already reconnected in the meantime
    player.connectionState = 'forfeited';
    player.forfeitTimer = null;
    this.broadcastRoom(room);

    if (room.status === 'ready_check' || room.status === 'starting') {
      // Can't run a valid duel/squad short a seat, and this product doesn't backfill a
      // half-started lobby — cancel cleanly and refund everyone rather than leave the
      // remaining players stuck waiting on a seat that is never coming back.
      this.cancelRoom(room);
      return;
    }
    if (room.status === 'active') {
      const stillIn = [...room.players.values()].filter((p) => p.connectionState !== 'forfeited');
      if (room.format === 'duel' && stillIn.length <= 1) {
        this.endMatch(room, 'forfeit');
      } else if (stillIn.length === 0) {
        this.endMatch(room, 'forfeit');
      }
    }
  }

  /** Refunds every still-seated player and tears the room down without ever attempting to
   *  pick a winner — used for both a ready-check timeout and a pre-start forfeit, i.e. any
   *  case where a full match could never legitimately be played out. */
  private cancelRoom(room: Room, reason: 'ready_timeout' | 'forfeit' | 'admin_cancelled' = 'ready_timeout') {
    if (room.status === 'finished' || room.status === 'cancelled') return;
    room.status = 'cancelled';
    room.clearTimers();

    const key = this.queueKey(room.gameKind, room.format, room.entryFee);
    if (this.openQueues.get(key) === room) this.openQueues.delete(key);

    for (const player of room.players.values()) {
      if (player.connectionState !== 'forfeited') refundEntryFee(player.userId, room.entryFee, room.id);
      this.io.to(player.socketId).emit('match:cancelled', { roomId: room.id, reason });
      this.io.to(player.socketId).emit('room:update', toRoomPublic(room, player.userId));
    }

    recordMatch({
      roomId: room.id,
      gameKind: room.gameKind,
      format: room.format,
      entryFee: room.entryFee,
      pool: room.pool,
      platformCut: 0,
      playerCount: room.players.size,
      status: 'cancelled',
      endedBy: null,
      isVoidMatch: true,
      isDraw: false,
      startedAt: room.matchStartedAt,
      endedAt: Date.now(),
      playerIds: [...room.players.keys()],
      winnerIds: [],
    });

    setTimeout(() => {
      for (const p of room.players.values()) {
        if (this.activeRoomByUser.get(p.userId) === room.id) this.activeRoomByUser.delete(p.userId);
      }
      this.rooms.delete(room.id);
    }, 10_000);
  }

  private enterReadyCheck(room: Room) {
    room.status = 'ready_check';
    const timeoutMs = getEffectiveGameConfig().lobbyReadyTimeoutMs;
    room.readyDeadline = Date.now() + timeoutMs;
    for (const player of room.players.values()) {
      this.io.to(player.socketId).emit('match:found', toRoomPublic(room, player.userId));
    }
    this.broadcastRoom(room);
    const timer = setTimeout(() => {
      if (room.status === 'ready_check') this.cancelRoom(room, 'ready_timeout');
    }, timeoutMs);
    room.timers.push(timer);
  }

  setReady(roomId: string, userId: string) {
    const room = this.rooms.get(roomId);
    if (!room || room.status !== 'ready_check') return;
    const player = room.players.get(userId);
    if (!player || player.connectionState !== 'connected') return;
    player.ready = true;
    this.broadcastRoom(room);

    const active = [...room.players.values()].filter((p) => p.connectionState !== 'forfeited');
    const allReady = active.length === room.maxPlayers && active.every((p) => p.ready);
    if (allReady) this.startCountdown(room);
  }

  private startCountdown(room: Room) {
    room.clearTimers(); // cancel the ready-check timeout — everyone is in, no need for it
    room.status = 'starting';
    const readyCountdownMs = getEffectiveGameConfig().readyCountdownMs;
    room.startsAt = Date.now() + readyCountdownMs;
    this.broadcastRoom(room);
    const timer = setTimeout(() => this.startMatch(room), readyCountdownMs);
    room.timers.push(timer);
  }

  private startMatch(room: Room) {
    room.status = 'active';
    room.matchStartedAt = Date.now();
    const matchDurationMs = getEffectiveGameConfig().matchDurationMs;
    room.matchEndsAt = Date.now() + matchDurationMs;
    this.broadcastRoom(room);

    for (const player of room.players.values()) {
      this.startRound(room, player);
    }

    const timer = setTimeout(() => this.endMatch(room, 'timer'), matchDurationMs);
    room.timers.push(timer);
  }

  /**
   * Starts one round for one player, split into two server-timed phases instead of one
   * payload containing both the target and the options (see AUDIT_REPORT.md's "question
   * payload leaks the correct answer" finding):
   *
   *   1. TARGET_REVEAL (`match:round:reveal`) — sent immediately, contains only the
   *      target's asset id and a `revealDeadline` the server itself will honor.
   *   2. ANSWER_PHASE (`match:round:options`) — sent only after `memorizeMs` has
   *      genuinely elapsed *server-side* (a real `setTimeout`, not a client-computed
   *      phase), containing the shuffled option set (each with its own random,
   *      unrelated-to-its-asset `token`) plus an authoritative `answerDeadline` and
   *      `minAnswerAt`.
   *
   * There is no "chances" or elimination gate here anymore — every connected player keeps
   * getting a fresh round immediately after each of theirs resolves (correct, wrong, or
   * timed out) for as long as the match clock is running. The server tracks all of this as
   * the player's `activeRound` and is the only thing that ever decides correctness, timing
   * validity, or advancement — see submitAnswer() and expireRound() below.
   */
  private startRound(room: Room, player: RoomPlayer) {
    if (room.status !== 'active') return;
    if (player.connectionState !== 'connected') return;
    if (room.matchEndsAt !== null && Date.now() >= room.matchEndsAt) return;

    const generated = generateRound(room.gameKind);
    const roundId = newRoundToken();
    const memorizeMs = getEffectiveGameConfig().roundMemorizeMs;
    const answerMs = getEffectiveGameConfig().roundAnswerMs;
    const dispatchedAt = Date.now();
    const revealDeadline = dispatchedAt + memorizeMs;

    const activeRound: ActiveRound = {
      roundId,
      phase: 'reveal',
      correctToken: generated.correctToken,
      dispatchedAt,
      revealDeadline,
      answerDeadline: 0, // filled in once the answer phase actually begins
      minAnswerAt: 0,
      resolved: false,
      advanceTimer: null,
      expireTimer: null,
    };
    player.activeRound = activeRound;

    const revealPayload: RoundRevealPublic = {
      roundId,
      kind: room.gameKind,
      memorizeMs,
      revealDeadline,
      prompt: { assetId: generated.targetAssetId },
    };
    this.io.to(player.socketId).emit('match:round:reveal', revealPayload);

    activeRound.advanceTimer = setTimeout(() => {
      if (activeRound.resolved || player.activeRound !== activeRound) return; // superseded/cancelled
      if (room.status !== 'active' || player.connectionState !== 'connected') return;

      const now = Date.now();
      activeRound.phase = 'answer';
      activeRound.answerDeadline = now + answerMs;
      activeRound.minAnswerAt = now + MIN_REACTION_MS;

      const optionsPayload: RoundOptionsPublic = {
        roundId,
        kind: room.gameKind,
        answerMs,
        answerDeadline: activeRound.answerDeadline,
        minAnswerAt: activeRound.minAnswerAt,
        options: generated.options,
      };
      this.io.to(player.socketId).emit('match:round:options', optionsPayload);

      activeRound.expireTimer = setTimeout(() => this.expireRound(room, player, activeRound), answerMs);
    }, memorizeMs);
  }

  /** Fires when a round's answer window elapses with no valid answer submitted. Treated
   *  exactly the same as a wrong answer (score -= 1) so stalling is never "free" compared
   *  to genuinely (and wrongly) answering, then the player is immediately advanced to
   *  their next round — nobody is ever left stuck staring at the same image. */
  private expireRound(room: Room, player: RoomPlayer, round: ActiveRound) {
    if (round.resolved || player.activeRound !== round) return;
    round.resolved = true;

    player.score += getEffectiveGameConfig().wrongPenaltyDelta;
    player.wrong += 1;
    player.lastAnswerAt = Date.now();
    player.activeRound = null;
    recordEvent('roundTimeout', player.userId);

    const timeoutPayload: RoundTimeoutPublic = { roundId: round.roundId, correctToken: round.correctToken, score: player.score };
    this.io.to(player.socketId).emit('match:round:timeout', timeoutPayload);

    this.broadcastRoom(room);
    this.startRound(room, player);
  }

  /**
   * The sole place correctness is ever decided. `userId` is the session-authenticated
   * caller (see index.ts) — there is no client-supplied identity involved. The client
   * submits only `roundId` + `optionToken`; every other fact (what the correct token is,
   * whether this round is still open, whether it's too early/too late) comes from the
   * server's own `activeRound` state, never from anything the client asserts.
   */
  submitAnswer(roomId: string, userId: string, roundId: string, optionToken: string): { correct: boolean; correctToken: string; score: number } {
    const room = this.rooms.get(roomId);
    if (!room || room.status !== 'active') throw new Error('Match is not live');
    const player = room.players.get(userId);
    if (!player || player.connectionState !== 'connected') {
      recordEvent('nonMemberAnswerAttempt', userId);
      throw new RoomAuthorizationError('Player not in an active match');
    }

    const round = player.activeRound;
    if (!round || round.roundId !== roundId) {
      // Covers stale rounds, future/guessed round ids, and answering after the round was
      // already superseded — none of these can ever be treated as "the current round".
      recordEvent('staleRoundRejected', userId);
      throw new Error('Stale or unknown round');
    }
    if (round.resolved) throw new Error('Round already answered');
    if (round.phase !== 'answer') throw new Error('Options have not been revealed yet');

    const now = Date.now();
    if (now < round.minAnswerAt) {
      recordEvent('tooFastRejected', userId);
      throw new Error('Answer rejected: submitted faster than humanly possible');
    }
    if (now > round.answerDeadline) throw new Error('Round expired');
    if (room.matchEndsAt !== null && now >= room.matchEndsAt) throw new Error('Match has already ended');

    // Resolve immediately, before doing anything else, so no other code path (including
    // the expiry timer firing a moment later) can ever process this same round twice.
    round.resolved = true;
    if (round.expireTimer) clearTimeout(round.expireTimer);
    player.activeRound = null;

    const config = getEffectiveGameConfig();
    const correct = optionToken === round.correctToken;
    if (correct) {
      player.score += config.correctScoreDelta;
      player.correct += 1;
    } else {
      player.score += config.wrongPenaltyDelta;
      player.wrong += 1;
    }
    player.lastAnswerAt = now;
    recordEvent('answerSubmitted', userId);

    this.broadcastRoom(room);
    this.startRound(room, player);

    return { correct, correctToken: round.correctToken, score: player.score };
  }

  private endMatch(room: Room, endedBy: 'timer' | 'forfeit' | 'admin_cancelled') {
    if (room.status === 'finished' || room.status === 'cancelled') return;
    room.status = 'finished';
    room.clearTimers();

    const players = [...room.players.values()];
    const computed = computeMatchPayout(
      room.pool,
      players.map((p) => ({
        userId: p.userId,
        score: p.score,
        correct: p.correct,
        wrong: p.wrong,
        lastAnswerAt: p.lastAnswerAt,
        forfeited: p.connectionState === 'forfeited',
      })),
      room.winnerCount,
    );
    // An admin force-closing a broken/stuck match is ALWAYS treated as a full void/refund,
    // never a computed winner — this is what makes "admin picks a winner by force-ending at
    // a convenient moment" structurally impossible rather than merely discouraged. There is
    // no code path anywhere in this file that lets an admin action result in a payout.
    const isVoidMatch = endedBy === 'admin_cancelled' ? true : computed.isVoidMatch;
    const isDraw = endedBy === 'admin_cancelled' ? false : computed.isDraw;
    const winnerIds = endedBy === 'admin_cancelled' ? new Set<string>() : computed.winnerIds;
    const platformCut = endedBy === 'admin_cancelled' ? 0 : computed.platformCut;
    const winnerPayoutTotal = endedBy === 'admin_cancelled' ? 0 : computed.winnerPayoutTotal;
    const payoutByUserId = endedBy === 'admin_cancelled' ? new Map<string, number>() : computed.payoutByUserId;
    const ranked = computed.ranked;
    const shouldRefund = isVoidMatch || isDraw;

    if (room.pool > 0 && !shouldRefund) {
      recordTransaction({
        id: nanoid(12),
        userId: 'PLATFORM',
        type: 'platform_fee',
        amount: platformCut,
        roomId: room.id,
        balanceAfter: platformCut,
        timestamp: Date.now(),
        status: 'completed',
      });
    }

    // computeMatchPayout and the payout/refund credits below are identical for every
    // viewer — only the *player identity* in the broadcast payload needs to be
    // personalized per recipient (see AUDIT_REPORT.md id-leak finding), so we compute the
    // shared numbers once and then emit one customized payload per connected socket.
    const baseResults = ranked.map((ranked_p) => {
      const p = room.players.get(ranked_p.userId);
      if (!p) throw new Error('Ranked player missing from room'); // invariant: ranked() only reorders the same player set
      const isWinner = winnerIds.has(p.userId);
      const payout = shouldRefund ? room.entryFee : (payoutByUserId.get(p.userId) ?? 0);
      if (shouldRefund) refundEntryFee(p.userId, room.entryFee, room.id);
      else if (payout > 0) creditPayout(p.userId, payout, room.id);
      return { player: p, score: p.score, correct: p.correct, wrong: p.wrong, payout, isWinner };
    });

    for (const player of room.players.values()) {
      const results: MatchResultPlayer[] = baseResults.map((r) => ({
        id: r.player.userId === player.userId ? r.player.userId : r.player.publicId,
        name: r.player.name,
        score: r.score,
        correct: r.correct,
        wrong: r.wrong,
        payout: r.payout,
        isWinner: r.isWinner,
        connectionState: r.player.connectionState,
      }));
      const payload: MatchResultPublic = {
        roomId: room.id,
        gameKind: room.gameKind,
        format: room.format,
        entryFee: room.entryFee,
        pool: room.pool,
        platformCut,
        winnerPayoutTotal,
        isVoidMatch,
        isDraw,
        endedBy,
        results,
      };
      if (player.connectionState !== 'forfeited') this.io.to(player.socketId).emit('match:end', payload);
    }

    recordMatch({
      roomId: room.id,
      gameKind: room.gameKind,
      format: room.format,
      entryFee: room.entryFee,
      pool: room.pool,
      platformCut,
      playerCount: room.players.size,
      status: 'finished',
      endedBy,
      isVoidMatch,
      isDraw,
      startedAt: room.matchStartedAt,
      endedAt: Date.now(),
      playerIds: [...room.players.keys()],
      winnerIds: [...winnerIds],
    });

    // Keep the finished room around briefly for late joiners/reconnects/rematch requests
    // to read state, then drop it and forget every player's association with it.
    setTimeout(() => {
      for (const p of room.players.values()) {
        if (this.activeRoomByUser.get(p.userId) === room.id) this.activeRoomByUser.delete(p.userId);
      }
      this.rooms.delete(room.id);
    }, 30_000);
  }

  // ---------------------------------------------------------------------------
  // Admin-only read/moderation surface (see admin/rooms.ts, which is the only caller —
  // itself gated behind admin auth + the `rooms.view`/`rooms.moderate` permissions). These
  // never accept a client-supplied player identity, correctness, or score — they only ever
  // read the server's own authoritative room state, or force a room out of a broken/stuck
  // state via the exact same cancel/void code paths normal gameplay already uses.
  // ---------------------------------------------------------------------------

  /** Every room this process currently holds in memory (including ones that just finished
   *  or were cancelled but haven't been purged yet — see the 10s/30s cleanup timers above).
   *  Player identity is the room-scoped `publicId` for every occupant, deliberately never
   *  the real account id, for the same "don't expose private player information
   *  unnecessarily" reason player-facing broadcasts already redact it. */
  listRoomsAdmin(): AdminRoomSummary[] {
    return [...this.rooms.values()].map((r) => this.toAdminSummary(r));
  }

  private toAdminSummary(r: Room): AdminRoomSummary {
    return {
      id: r.id,
      gameKind: r.gameKind,
      format: r.format,
      entryFee: r.entryFee,
      status: r.status,
      playerCount: r.players.size,
      maxPlayers: r.maxPlayers,
      pool: r.pool,
      createdAt: r.createdAt,
      matchStartedAt: r.matchStartedAt,
      matchEndsAt: r.matchEndsAt,
      readyDeadline: r.readyDeadline,
      startsAt: r.startsAt,
    };
  }

  getRoomAdminDetail(roomId: string): AdminRoomDetail | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    return {
      ...this.toAdminSummary(room),
      players: [...room.players.values()].map((p) => ({
        id: p.publicId,
        name: p.name,
        ready: p.ready,
        score: p.score,
        correct: p.correct,
        wrong: p.wrong,
        connectionState: p.connectionState,
        hasActiveRound: p.activeRound !== null,
        activeRoundPhase: p.activeRound?.phase ?? null,
        lastAnswerAt: p.lastAnswerAt,
      })),
    };
  }

  /** Force-closes a room stuck in any pre-active or active state. Pre-active statuses use
   *  exactly the existing cancel-and-refund path; an active match is always ended as a full
   *  void/refund (see endMatch's admin_cancelled handling) — there is deliberately no way
   *  for this method to produce a winner or touch any player's score. */
  adminCancelRoom(roomId: string): { ok: boolean; message: string } {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, message: 'Room not found (it may have already been cleaned up)' };
    if (room.status === 'finished' || room.status === 'cancelled') {
      return { ok: false, message: `Room is already ${room.status}` };
    }
    if (room.status === 'queued') {
      for (const player of [...room.players.values()]) this.leaveRoom(room.id, player.userId);
      return { ok: true, message: 'Queued room cleared and every seated player refunded' };
    }
    if (room.status === 'ready_check' || room.status === 'starting') {
      this.cancelRoom(room, 'admin_cancelled');
      return { ok: true, message: 'Lobby cancelled and every seated player refunded' };
    }
    // active
    this.endMatch(room, 'admin_cancelled');
    return { ok: true, message: 'Match force-closed as a void match — every entry fee refunded, no winner declared' };
  }
}

export { InsufficientFundsError };
export type { PlayerConnectionState };

export interface AdminRoomSummary {
  id: string;
  gameKind: GameKind;
  format: RoomFormat;
  entryFee: number;
  status: RoomStatus;
  playerCount: number;
  maxPlayers: number;
  pool: number;
  createdAt: number;
  matchStartedAt: number | null;
  matchEndsAt: number | null;
  readyDeadline: number | null;
  startsAt: number | null;
}

export interface AdminRoomPlayerDetail {
  id: string;
  name: string;
  ready: boolean;
  score: number;
  correct: number;
  wrong: number;
  connectionState: PlayerConnectionState;
  hasActiveRound: boolean;
  activeRoundPhase: 'reveal' | 'answer' | null;
  lastAnswerAt: number | null;
}

export interface AdminRoomDetail extends AdminRoomSummary {
  players: AdminRoomPlayerDetail[];
}
