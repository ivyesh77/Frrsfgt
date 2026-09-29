import { nanoid } from 'nanoid';
import type { Server } from 'socket.io';
import { generateRound } from './gameKinds/index.js';
import { newRoundToken } from './gameKinds/shared.js';
import { computeMatchPayout } from './payout.js';
import { debitEntryFee, refundEntryFee, creditPayout, InsufficientFundsError } from './wallet.js';
import { recordTransaction } from './store.js';
import {
  getMatchDurationMs,
  roomFormatMeta,
  getReadyCountdownMs,
  getRoundMemorizeMs,
  getRoundAnswerMs,
  MIN_REACTION_MS,
  STARTING_CHANCES,
  type ActiveRound,
  type GameKind,
  type MatchResultPlayer,
  type MatchResultPublic,
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
  status: RoomStatus = 'waiting';
  players = new Map<string, RoomPlayer>();
  pool = 0;
  countdownEndsAt: number | null = null;
  matchEndsAt: number | null = null;
  timers: NodeJS.Timeout[] = [];

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
    for (const player of this.players.values()) clearPlayerRoundTimers(player);
  }
}

function clearPlayerRoundTimers(player: RoomPlayer): void {
  if (!player.activeRound) return;
  if (player.activeRound.advanceTimer) clearTimeout(player.activeRound.advanceTimer);
  if (player.activeRound.expireTimer) clearTimeout(player.activeRound.expireTimer);
}

/** `viewerUserId` is whichever socket this payload is being sent to — every OTHER
 *  occupant's real account id is replaced with their room-scoped opaque `publicId`, so a
 *  player can never learn another player's actual account id just by sharing a room with
 *  them (see AUDIT_REPORT.md — this was a live, verified wallet-drain vector). The
 *  viewer's own entry keeps its real id so the client can tell which seat is "me". */
function toPlayerPublic(p: RoomPlayer, viewerUserId: string): RoomPlayerPublic {
  return {
    id: p.userId === viewerUserId ? p.userId : p.publicId,
    name: p.name,
    ready: p.ready,
    score: p.score,
    chancesLeft: p.chancesLeft,
    connected: p.connected,
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
    countdownEndsAt: room.countdownEndsAt,
    matchEndsAt: room.matchEndsAt,
  };
}

export class RoomManager {
  private rooms = new Map<string, Room>();

  constructor(private io: Server) {}

  listRooms(gameKind?: GameKind): RoomSummary[] {
    return [...this.rooms.values()]
      .filter((r) => r.status !== 'finished' && (!gameKind || r.gameKind === gameKind))
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

  getRoomPublic(roomId: string, viewerUserId: string): RoomStatePublic | null {
    const room = this.rooms.get(roomId);
    return room ? toRoomPublic(room, viewerUserId) : null;
  }

  createRoom(gameKind: GameKind, entryFee: number, format: RoomFormat): Room {
    const room = new Room(gameKind, entryFee, format);
    this.rooms.set(room.id, room);
    return room;
  }

  private broadcastRoom(room: Room) {
    for (const player of room.players.values()) {
      if (!player.connected) continue;
      this.io.to(player.socketId).emit('room:update', toRoomPublic(room, player.userId));
    }
  }

  /** Debits the entry fee and seats the player. Throws on invalid state or insufficient
   *  funds. `user` must already be the session-authenticated caller — see index.ts, which
   *  is the only place allowed to resolve a `User` from a request and it always does so
   *  from the authenticated session, never from a client-supplied id. */
  joinRoom(roomId: string, user: User, socketId: string): Room {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('Room not found');
    if (room.status !== 'waiting') throw new Error('Room already started');
    if (room.players.has(user.id)) {
      // Reconnect case: just refresh the socket id.
      const existing = room.players.get(user.id)!;
      existing.socketId = socketId;
      existing.connected = true;
      this.broadcastRoom(room);
      return room;
    }
    if (room.players.size >= room.maxPlayers) throw new Error('Room is full');

    debitEntryFee(user.id, room.entryFee, room.id); // throws InsufficientFundsError if short
    room.pool += room.entryFee;

    const player: RoomPlayer = {
      userId: user.id,
      publicId: nanoid(10),
      name: user.name,
      socketId,
      ready: false,
      score: 0,
      chancesLeft: STARTING_CHANCES,
      correct: 0,
      wrong: 0,
      lastAnswerAt: null,
      connected: true,
      activeRound: null,
    };
    room.players.set(user.id, player);
    this.broadcastRoom(room);
    return room;
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

    if (room.status === 'waiting' || room.status === 'countdown') {
      refundEntryFee(userId, room.entryFee, room.id);
      room.pool -= room.entryFee;
      room.players.delete(userId);
      if (room.status === 'countdown' && room.players.size < room.maxPlayers) {
        room.status = 'waiting';
        room.countdownEndsAt = null;
        room.clearTimers();
      }
      this.broadcastRoom(room);
      if (room.players.size === 0) this.rooms.delete(room.id);
    } else if (room.status === 'live') {
      // No refund once the match is live — mark disconnected, keep their score standing.
      clearPlayerRoundTimers(player);
      player.connected = false;
      this.broadcastRoom(room);
    }
  }

  handleDisconnect(roomId: string, userId: string, socketId: string) {
    const room = this.rooms.get(roomId);
    const player = room?.players.get(userId);
    if (!room || !player || player.socketId !== socketId) return;
    this.leaveRoom(roomId, userId);
  }

  setReady(roomId: string, userId: string) {
    const room = this.rooms.get(roomId);
    if (!room || room.status !== 'waiting') return;
    const player = room.players.get(userId);
    if (!player) return;
    player.ready = true;
    this.broadcastRoom(room);

    const readyCount = [...room.players.values()].filter((p) => p.ready).length;
    if (readyCount >= room.maxPlayers && readyCount === room.players.size) {
      this.startCountdown(room);
    }
  }

  private startCountdown(room: Room) {
    room.status = 'countdown';
    const readyCountdownMs = getReadyCountdownMs();
    room.countdownEndsAt = Date.now() + readyCountdownMs;
    this.broadcastRoom(room);
    const timer = setTimeout(() => this.startMatch(room), readyCountdownMs);
    room.timers.push(timer);
  }

  private startMatch(room: Room) {
    room.status = 'live';
    const matchDurationMs = getMatchDurationMs();
    room.matchEndsAt = Date.now() + matchDurationMs;
    this.broadcastRoom(room);

    for (const player of room.players.values()) {
      this.startRound(room, player);
    }

    const timer = setTimeout(() => this.endMatch(room), matchDurationMs);
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
   * The server tracks all of this as the player's `activeRound` and is the only thing
   * that ever decides correctness, timing validity, or advancement — see submitAnswer()
   * and expireRound() below.
   */
  private startRound(room: Room, player: RoomPlayer) {
    if (room.status !== 'live') return;
    if (!player.connected || player.chancesLeft <= 0) return;
    if (room.matchEndsAt !== null && Date.now() >= room.matchEndsAt) return;

    const generated = generateRound(room.gameKind);
    const roundId = newRoundToken();
    const memorizeMs = getRoundMemorizeMs();
    const answerMs = getRoundAnswerMs();
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
      if (room.status !== 'live' || !player.connected) return;

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

  /** Fires when a round's answer window elapses with no valid answer submitted — the
   *  server-side fix for the audit's "an unanswered question freezes forever" finding.
   *  Treated the same as a wrong answer (costs a chance) so stalling is never "free"
   *  compared to genuinely answering, then the player is advanced to their next round. */
  private expireRound(room: Room, player: RoomPlayer, round: ActiveRound) {
    if (round.resolved || player.activeRound !== round) return;
    round.resolved = true;

    player.chancesLeft = Math.max(0, player.chancesLeft - 1);
    player.wrong += 1;
    player.lastAnswerAt = Date.now();
    player.activeRound = null;

    const timeoutPayload: RoundTimeoutPublic = { roundId: round.roundId, correctToken: round.correctToken };
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
  submitAnswer(roomId: string, userId: string, roundId: string, optionToken: string): { correct: boolean; correctToken: string } {
    const room = this.rooms.get(roomId);
    if (!room || room.status !== 'live') throw new Error('Match is not live');
    const player = room.players.get(userId);
    if (!player || !player.connected) throw new RoomAuthorizationError('Player not in match');

    const round = player.activeRound;
    if (!round || round.roundId !== roundId) {
      // Covers stale rounds, future/guessed round ids, and answering after the round was
      // already superseded — none of these can ever be treated as "the current round".
      throw new Error('Stale or unknown round');
    }
    if (round.resolved) throw new Error('Round already answered');
    if (round.phase !== 'answer') throw new Error('Options have not been revealed yet');

    const now = Date.now();
    if (now < round.minAnswerAt) throw new Error('Answer rejected: submitted faster than humanly possible');
    if (now > round.answerDeadline) throw new Error('Round expired');

    // Resolve immediately, before doing anything else, so no other code path (including
    // the expiry timer firing a moment later) can ever process this same round twice.
    round.resolved = true;
    if (round.expireTimer) clearTimeout(round.expireTimer);
    player.activeRound = null;

    const correct = optionToken === round.correctToken;
    if (correct) {
      player.score += 1;
      player.correct += 1;
    } else {
      player.chancesLeft = Math.max(0, player.chancesLeft - 1);
      player.wrong += 1;
    }
    player.lastAnswerAt = now;

    this.broadcastRoom(room);
    this.startRound(room, player);

    return { correct, correctToken: round.correctToken };
  }

  private endMatch(room: Room) {
    if (room.status === 'finished') return;
    room.status = 'finished';
    room.clearTimers();

    const players = [...room.players.values()];
    const { ranked, isVoidMatch, winnerIds, platformCut, winnerPayoutTotal, payoutByUserId } = computeMatchPayout(
      room.pool,
      players.map((p) => ({ userId: p.userId, score: p.score, wrong: p.wrong, lastAnswerAt: p.lastAnswerAt })),
      room.winnerCount,
    );

    if (room.pool > 0 && !isVoidMatch) {
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
      const payout = isVoidMatch ? room.entryFee : (payoutByUserId.get(p.userId) ?? 0);
      if (isVoidMatch) refundEntryFee(p.userId, room.entryFee, room.id);
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
        results,
      };
      this.io.to(player.socketId).emit('match:end', payload);
    }

    // Keep the finished room around briefly for late joiners/reconnects to read state, then drop it.
    setTimeout(() => this.rooms.delete(room.id), 30_000);
  }
}

export { InsufficientFundsError };
