import { nanoid } from 'nanoid';
import type { Server } from 'socket.io';
import { generateQuestion } from './gameKinds/index.js';
import { computeMatchPayout } from './payout.js';
import { debitEntryFee, refundEntryFee, creditPayout, InsufficientFundsError } from './wallet.js';
import { recordTransaction } from './store.js';
import {
  getMatchDurationMs,
  MAX_PLAYERS_PER_ROOM,
  MIN_PLAYERS_TO_START,
  getReadyCountdownMs,
  STARTING_CHANCES,
  type ArcadeQuestionPublic,
  type GameKind,
  type MatchResultPlayer,
  type MatchResultPublic,
  type RoomPlayer,
  type RoomPlayerPublic,
  type RoomStatePublic,
  type RoomStatus,
  type RoomSummary,
  type User,
} from './types.js';

interface ActiveQuestion {
  correctIndex: number;
  userId: string;
  kind: GameKind;
}

class Room {
  id = nanoid(8);
  gameKind: GameKind;
  entryFee: number;
  status: RoomStatus = 'waiting';
  players = new Map<string, RoomPlayer>();
  pool = 0;
  countdownEndsAt: number | null = null;
  matchEndsAt: number | null = null;
  activeQuestions = new Map<string, ActiveQuestion>();
  timers: NodeJS.Timeout[] = [];

  constructor(gameKind: GameKind, entryFee: number) {
    this.gameKind = gameKind;
    this.entryFee = entryFee;
  }

  clearTimers() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }
}

function toPlayerPublic(p: RoomPlayer): RoomPlayerPublic {
  return {
    userId: p.userId,
    name: p.name,
    ready: p.ready,
    score: p.score,
    chancesLeft: p.chancesLeft,
    connected: p.connected,
  };
}

function toRoomPublic(room: Room): RoomStatePublic {
  return {
    id: room.id,
    gameKind: room.gameKind,
    entryFee: room.entryFee,
    status: room.status,
    pool: room.pool,
    players: [...room.players.values()].map(toPlayerPublic),
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
        entryFee: r.entryFee,
        status: r.status,
        playerCount: r.players.size,
        maxPlayers: MAX_PLAYERS_PER_ROOM,
      }));
  }

  getRoomPublic(roomId: string): RoomStatePublic | null {
    const room = this.rooms.get(roomId);
    return room ? toRoomPublic(room) : null;
  }

  createRoom(gameKind: GameKind, entryFee: number): Room {
    const room = new Room(gameKind, entryFee);
    this.rooms.set(room.id, room);
    return room;
  }

  private broadcastRoom(room: Room) {
    this.io.to(room.id).emit('room:update', toRoomPublic(room));
  }

  /** Debits the entry fee and seats the player. Throws on invalid state or insufficient funds. */
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
    if (room.players.size >= MAX_PLAYERS_PER_ROOM) throw new Error('Room is full');

    debitEntryFee(user.id, room.entryFee, room.id); // throws InsufficientFundsError if short
    room.pool += room.entryFee;

    const player: RoomPlayer = {
      userId: user.id,
      name: user.name,
      socketId,
      ready: false,
      score: 0,
      chancesLeft: STARTING_CHANCES,
      correct: 0,
      wrong: 0,
      lastAnswerAt: null,
      connected: true,
    };
    room.players.set(user.id, player);
    this.broadcastRoom(room);
    return room;
  }

  leaveRoom(roomId: string, userId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(userId);
    if (!player) return;

    if (room.status === 'waiting' || room.status === 'countdown') {
      refundEntryFee(userId, room.entryFee, room.id);
      room.pool -= room.entryFee;
      room.players.delete(userId);
      if (room.status === 'countdown' && room.players.size < MIN_PLAYERS_TO_START) {
        room.status = 'waiting';
        room.countdownEndsAt = null;
        room.clearTimers();
      }
      this.broadcastRoom(room);
      if (room.players.size === 0) this.rooms.delete(room.id);
    } else if (room.status === 'live') {
      // No refund once the match is live — mark disconnected, keep their score standing.
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
    if (readyCount >= MIN_PLAYERS_TO_START && readyCount === room.players.size) {
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
      this.dispatchNextQuestion(room, player);
    }

    const timer = setTimeout(() => this.endMatch(room), matchDurationMs);
    room.timers.push(timer);
  }

  private dispatchNextQuestion(room: Room, player: RoomPlayer) {
    if (room.status !== 'live') return;
    if (!player.connected || player.chancesLeft <= 0) return;
    if (room.matchEndsAt !== null && Date.now() >= room.matchEndsAt) return;

    const { question, correctIndex } = generateQuestion(room.gameKind);
    room.activeQuestions.set(question.id, { correctIndex, userId: player.userId, kind: room.gameKind });
    player.currentQuestionId = question.id;

    this.io.to(player.socketId).emit('match:question', question satisfies ArcadeQuestionPublic);

    if (question.kind === 'reactionTap') {
      const revealTimer = setTimeout(() => {
        if (player.currentQuestionId !== question.id) return; // already answered/expired
        this.io.to(player.socketId).emit('match:reveal', { questionId: question.id, index: correctIndex });
      }, question.memorizeMs);
      room.timers.push(revealTimer);
    }
  }

  submitAnswer(
    roomId: string,
    userId: string,
    questionId: string,
    choiceIndex: number,
  ): { correct: boolean; correctIndex: number } {
    const room = this.rooms.get(roomId);
    if (!room || room.status !== 'live') throw new Error('Match is not live');
    const player = room.players.get(userId);
    if (!player || !player.connected) throw new Error('Player not in match');
    if (player.currentQuestionId !== questionId) {
      throw new Error('Stale or duplicate answer'); // prevents double-submission / replay
    }

    const active = room.activeQuestions.get(questionId);
    if (!active) throw new Error('Unknown question');

    player.currentQuestionId = undefined;
    room.activeQuestions.delete(questionId);

    const correct = choiceIndex === active.correctIndex;
    if (correct) {
      player.score += 1;
      player.correct += 1;
    } else {
      player.chancesLeft = Math.max(0, player.chancesLeft - 1);
      player.wrong += 1;
    }
    player.lastAnswerAt = Date.now();

    this.broadcastRoom(room);
    this.dispatchNextQuestion(room, player);

    return { correct, correctIndex: active.correctIndex };
  }

  private endMatch(room: Room) {
    if (room.status === 'finished') return;
    room.status = 'finished';
    room.clearTimers();

    const players = [...room.players.values()];
    const { ranked, isVoidMatch, winnerIds, platformCut, winnerPayoutTotal, perWinnerPayout } = computeMatchPayout(
      room.pool,
      players.map((p) => ({ userId: p.userId, score: p.score, wrong: p.wrong, lastAnswerAt: p.lastAnswerAt })),
    );

    const results: MatchResultPlayer[] = ranked.map((ranked_p) => {
      const p = room.players.get(ranked_p.userId);
      if (!p) throw new Error('Ranked player missing from room'); // invariant: ranked() only reorders the same player set
      const isWinner = winnerIds.has(p.userId);
      const payout = isVoidMatch ? room.entryFee : isWinner ? perWinnerPayout : 0;
      if (isVoidMatch) refundEntryFee(p.userId, room.entryFee, room.id);
      else if (payout > 0) creditPayout(p.userId, payout, room.id);
      return {
        userId: p.userId,
        name: p.name,
        score: p.score,
        correct: p.correct,
        wrong: p.wrong,
        payout,
        isWinner,
      };
    });

    if (room.pool > 0 && !isVoidMatch) {
      recordTransaction({
        id: nanoid(12),
        userId: 'PLATFORM',
        type: 'platform_fee',
        amount: platformCut,
        roomId: room.id,
        balanceAfter: platformCut,
        timestamp: Date.now(),
      });
    }

    const payload: MatchResultPublic = {
      roomId: room.id,
      gameKind: room.gameKind,
      entryFee: room.entryFee,
      pool: room.pool,
      platformCut,
      winnerPayoutTotal,
      isVoidMatch,
      results,
    };

    this.io.to(room.id).emit('match:end', payload);

    // Keep the finished room around briefly for late joiners/reconnects to read state, then drop it.
    setTimeout(() => this.rooms.delete(room.id), 30_000);
  }
}

export { InsufficientFundsError };
