import { useCallback, useEffect, useReducer, useRef } from 'react';
import { fetchWallet, guestLogin, topUpWallet, type AuthMode } from './api';
import { getArenaSocket } from './socket';
import { loadStoredIdentity, saveStoredIdentity } from './storage';
import type { ArcadeQuestionPublic, ArenaUser, MatchResultPublic, RoomStatePublic, RoomSummary } from './types';

export type ArenaStage = 'login' | 'lobby' | 'room' | 'result';

export interface AnswerFeedback {
  questionId: string;
  correct: boolean;
  correctIndex: number;
}

interface ArenaState {
  stage: ArenaStage;
  user: ArenaUser | null;
  authenticating: boolean;
  rooms: RoomSummary[];
  room: RoomStatePublic | null;
  question: ArcadeQuestionPublic | null;
  questionReceivedAt: number | null;
  answerFeedback: AnswerFeedback | null;
  matchResult: MatchResultPublic | null;
  error: string | null;
  busy: boolean;
}

type Action =
  | { type: 'LOGIN_START' }
  | { type: 'LOGIN_SUCCESS'; user: ArenaUser }
  | { type: 'LOGIN_ERROR'; error: string }
  | { type: 'LOGIN_IDLE' }
  | { type: 'WALLET_REFRESHED'; user: ArenaUser }
  | { type: 'ROOMS_LIST'; rooms: RoomSummary[] }
  | { type: 'BUSY'; busy: boolean }
  | { type: 'JOIN_ROOM_SUCCESS'; room: RoomStatePublic }
  | { type: 'ROOM_UPDATE'; room: RoomStatePublic }
  | { type: 'LEAVE_ROOM' }
  | { type: 'QUESTION_RECEIVED'; question: ArcadeQuestionPublic }
  | { type: 'ANSWER_RESULT'; feedback: AnswerFeedback }
  | { type: 'MATCH_END'; result: MatchResultPublic }
  | { type: 'RESET_TO_LOBBY' }
  | { type: 'ERROR'; error: string | null };

const initialState: ArenaState = {
  stage: 'login',
  user: null,
  authenticating: false,
  rooms: [],
  room: null,
  question: null,
  questionReceivedAt: null,
  answerFeedback: null,
  matchResult: null,
  error: null,
  busy: false,
};

function reducer(state: ArenaState, action: Action): ArenaState {
  switch (action.type) {
    case 'LOGIN_START':
      return { ...state, authenticating: true, error: null };
    case 'LOGIN_SUCCESS':
      return { ...state, authenticating: false, user: action.user, stage: 'lobby', error: null };
    case 'LOGIN_ERROR':
      return { ...state, authenticating: false, error: action.error };
    case 'LOGIN_IDLE':
      return { ...state, authenticating: false };
    case 'WALLET_REFRESHED':
      return { ...state, user: action.user };
    case 'ROOMS_LIST':
      return { ...state, rooms: action.rooms };
    case 'BUSY':
      return { ...state, busy: action.busy };
    case 'JOIN_ROOM_SUCCESS':
      return {
        ...state,
        stage: 'room',
        room: action.room,
        busy: false,
        error: null,
        question: null,
        questionReceivedAt: null,
              answerFeedback: null,
        matchResult: null,
      };
    case 'ROOM_UPDATE':
      if (!state.room || state.room.id !== action.room.id) return state;
      return { ...state, room: action.room };
    case 'LEAVE_ROOM':
      return {
        ...state,
        stage: 'lobby',
        room: null,
        question: null,
        questionReceivedAt: null,
              answerFeedback: null,
        matchResult: null,
      };
    case 'QUESTION_RECEIVED':
      return {
        ...state,
        question: action.question,
        questionReceivedAt: Date.now(),
              answerFeedback: null,
      };
    case 'ANSWER_RESULT':
      return { ...state, answerFeedback: action.feedback };
    case 'MATCH_END':
      return { ...state, stage: 'result', matchResult: action.result, question: null };
    case 'RESET_TO_LOBBY':
      return { ...state, stage: 'lobby', room: null, matchResult: null, question: null, answerFeedback: null };
    case 'ERROR':
      return { ...state, error: action.error, busy: false };
    default:
      return state;
  }
}

function emitAck<T>(event: string, payload: unknown): Promise<T> {
  const socket = getArenaSocket();
  return new Promise((resolve) => {
    socket.emit(event, payload, (ack: T) => resolve(ack));
  });
}

export function useArena() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const userRef = useRef<ArenaUser | null>(null);
  const roomRef = useRef<RoomStatePublic | null>(null);
  const roomsRef = useRef<RoomSummary[]>([]);
  useEffect(() => {
    userRef.current = state.user;
    roomRef.current = state.room;
    roomsRef.current = state.rooms;
  }, [state.user, state.room, state.rooms]);

  // --- Socket event wiring (subscribed once for the whole Arena session) ---
  useEffect(() => {
    const socket = getArenaSocket();

    const onRoomUpdate = (room: RoomStatePublic) => dispatch({ type: 'ROOM_UPDATE', room });
    const onQuestion = (question: ArcadeQuestionPublic) => dispatch({ type: 'QUESTION_RECEIVED', question });
    const onMatchEnd = (result: MatchResultPublic) => {
      dispatch({ type: 'MATCH_END', result });
      // Wallet balance changed (entry fee + possible payout already applied server-side) — pull the fresh number.
      const uid = userRef.current?.id;
      if (uid) void fetchWallet(uid).then((user) => dispatch({ type: 'WALLET_REFRESHED', user }));
    };

    socket.on('room:update', onRoomUpdate);
    socket.on('match:question', onQuestion);
    socket.on('match:end', onMatchEnd);

    return () => {
      socket.off('room:update', onRoomUpdate);
      socket.off('match:question', onQuestion);
      socket.off('match:end', onMatchEnd);
    };
  }, []);

  // --- Auto-login from a previously stored guest identity -------------------
  useEffect(() => {
    const stored = loadStoredIdentity();
    if (!stored) return;
    dispatch({ type: 'LOGIN_START' });
    void fetchWallet(stored.userId)
      .then((user) => dispatch({ type: 'LOGIN_SUCCESS', user }))
      .catch(() => {
        /* stored identity no longer valid server-side (fresh server data) — fall back to login screen */
      });
  }, []);

  /**
   * Throws on failure (rather than pushing to the global toast) so the auth
   * modal can show the error inline, next to the field it applies to.
   */
  const login = useCallback(async (name: string, mode: AuthMode) => {
    dispatch({ type: 'LOGIN_START' });
    try {
      const user = await guestLogin(name, mode);
      saveStoredIdentity({ userId: user.id, name: user.name });
      dispatch({ type: 'LOGIN_SUCCESS', user });
    } catch (err) {
      dispatch({ type: 'LOGIN_IDLE' });
      throw err instanceof Error ? err : new Error('Login failed');
    }
  }, []);

  const refreshRooms = useCallback(async () => {
    try {
      const res = await fetch('/api/rooms');
      const body = (await res.json()) as { rooms: RoomSummary[] };
      dispatch({ type: 'ROOMS_LIST', rooms: body.rooms });
    } catch {
      // Transient network hiccup while polling the lobby — next poll will retry.
    }
  }, []);

  const topUp = useCallback(async (amount: number) => {
    if (!userRef.current) return;
    try {
      const user = await topUpWallet(userRef.current.id, amount);
      dispatch({ type: 'WALLET_REFRESHED', user });
    } catch (err) {
      dispatch({ type: 'ERROR', error: err instanceof Error ? err.message : 'Top-up failed' });
    }
  }, []);

  /**
   * Casino-style "pick a stake and play" flow: seats the player at an existing open
   * table for this entry fee if one has room, otherwise opens a fresh table — the
   * player never has to think about individual room ids or a separate create step.
   */
  const playAtFee = useCallback(async (entryFee: number) => {
    if (!userRef.current) return;
    dispatch({ type: 'BUSY', busy: true });

    const openTable = roomsRef.current.find(
      (r) => r.entryFee === entryFee && r.status === 'waiting' && r.playerCount < r.maxPlayers,
    );

    if (openTable) {
      const joinAck = await emitAck<{ ok: boolean; room?: RoomStatePublic; error?: string }>('rooms:join', {
        userId: userRef.current.id,
        roomId: openTable.id,
      });
      if (joinAck.ok && joinAck.room) {
        dispatch({ type: 'JOIN_ROOM_SUCCESS', room: joinAck.room });
        return;
      }
      // The table filled up (or vanished) between the last poll and this click —
      // fall through and open a brand new table instead of surfacing an error.
    }

    const createAck = await emitAck<{ ok: boolean; roomId?: string; error?: string }>('rooms:create', {
      gameKind: 'memoryMatch',
      entryFee,
    });
    if (!createAck.ok || !createAck.roomId) {
      dispatch({ type: 'ERROR', error: createAck.error ?? 'Could not start a table' });
      return;
    }
    const joinAck = await emitAck<{ ok: boolean; room?: RoomStatePublic; error?: string }>('rooms:join', {
      userId: userRef.current.id,
      roomId: createAck.roomId,
    });
    if (!joinAck.ok || !joinAck.room) {
      dispatch({ type: 'ERROR', error: joinAck.error ?? 'Could not join the table' });
      return;
    }
    dispatch({ type: 'JOIN_ROOM_SUCCESS', room: joinAck.room });
  }, []);

  const leaveRoom = useCallback(async () => {
    const room = roomRef.current;
    const user = userRef.current;
    if (!room || !user) {
      dispatch({ type: 'LEAVE_ROOM' });
      return;
    }
    await emitAck('rooms:leave', { userId: user.id, roomId: room.id });
    const refreshed = await fetchWallet(user.id).catch(() => null);
    if (refreshed) dispatch({ type: 'WALLET_REFRESHED', user: refreshed });
    dispatch({ type: 'LEAVE_ROOM' });
  }, []);

  const setReady = useCallback(async () => {
    const room = roomRef.current;
    const user = userRef.current;
    if (!room || !user) return;
    await emitAck('rooms:ready', { userId: user.id, roomId: room.id });
  }, []);

  const submitAnswer = useCallback(async (choiceIndex: number) => {
    const room = roomRef.current;
    const user = userRef.current;
    const question = state.question;
    if (!room || !user || !question) return;
    const ack = await emitAck<{ ok: boolean; correct?: boolean; correctIndex?: number; error?: string }>(
      'match:answer',
      { userId: user.id, roomId: room.id, questionId: question.id, choiceIndex },
    );
    if (ack.ok && ack.correct !== undefined && ack.correctIndex !== undefined) {
      dispatch({ type: 'ANSWER_RESULT', feedback: { questionId: question.id, correct: ack.correct, correctIndex: ack.correctIndex } });
    }
  }, [state.question]);

  const backToLobby = useCallback(() => {
    dispatch({ type: 'RESET_TO_LOBBY' });
  }, []);

  const clearError = useCallback(() => dispatch({ type: 'ERROR', error: null }), []);

  return {
    state,
    login,
    refreshRooms,
    topUp,
    playAtFee,
    leaveRoom,
    setReady,
    submitAnswer,
    backToLobby,
    clearError,
  };
}
