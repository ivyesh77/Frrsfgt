import { useCallback, useEffect, useReducer, useRef } from 'react';
import { fetchMe, fetchRooms, fetchWallet, login as apiLogin, logout as apiLogout, signup as apiSignup, topUpWallet, withdrawWallet } from './api';
import { disconnectArenaSocket, getArenaSocket } from './socket';
import type {
  ArenaUser,
  MatchResultPublic,
  RoomFormat,
  RoomStatePublic,
  RoomSummary,
  RoundOptionsPublic,
  RoundRevealPublic,
  RoundTimeoutPublic,
} from './types';

export type ArenaStage = 'login' | 'lobby' | 'room' | 'result' | 'profile';

/** One in-flight (or just-resolved) round, tracked entirely from server-pushed events —
 *  nothing here is computed or asserted by the client. `phase` mirrors which event was
 *  most recently received for this `roundId`. */
export interface ActiveRoundView {
  roundId: string;
  prompt: unknown;
  revealDeadline: number;
  options: RoundOptionsPublic['options'] | null;
  answerDeadline: number | null;
  minAnswerAt: number | null;
  /** Set once the server has told us this exact round is over (either we answered, or it
   *  timed out) — `pickedToken` is null for a timeout. */
  resolution: { correct: boolean; correctToken: string; pickedToken: string | null } | null;
}

interface ArenaState {
  stage: ArenaStage;
  user: ArenaUser | null;
  authenticating: boolean;
  bootstrapping: boolean;
  rooms: RoomSummary[];
  room: RoomStatePublic | null;
  round: ActiveRoundView | null;
  matchResult: MatchResultPublic | null;
  error: string | null;
  busy: boolean;
}

type Action =
  | { type: 'BOOTSTRAP_DONE'; user: ArenaUser | null }
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
  | { type: 'ROUND_REVEAL'; reveal: RoundRevealPublic }
  | { type: 'ROUND_OPTIONS'; options: RoundOptionsPublic }
  | { type: 'ROUND_ANSWERED'; roundId: string; correct: boolean; correctToken: string; pickedToken: string }
  | { type: 'ROUND_TIMEOUT'; timeout: RoundTimeoutPublic }
  | { type: 'MATCH_END'; result: MatchResultPublic }
  | { type: 'RESET_TO_LOBBY' }
  | { type: 'VIEW_PROFILE' }
  | { type: 'LOGOUT' }
  | { type: 'ERROR'; error: string | null };

const initialState: ArenaState = {
  stage: 'login',
  user: null,
  authenticating: false,
  bootstrapping: true,
  rooms: [],
  room: null,
  round: null,
  matchResult: null,
  error: null,
  busy: false,
};

function reducer(state: ArenaState, action: Action): ArenaState {
  switch (action.type) {
    case 'BOOTSTRAP_DONE':
      return action.user ? { ...state, user: action.user, stage: 'lobby', bootstrapping: false } : { ...state, bootstrapping: false };
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
      return { ...state, stage: 'room', room: action.room, busy: false, error: null, round: null, matchResult: null };
    case 'ROOM_UPDATE':
      if (!state.room || state.room.id !== action.room.id) return state;
      return { ...state, room: action.room };
    case 'LEAVE_ROOM':
      return { ...state, stage: 'lobby', room: null, round: null, matchResult: null };
    case 'ROUND_REVEAL':
      return {
        ...state,
        round: {
          roundId: action.reveal.roundId,
          prompt: action.reveal.prompt,
          revealDeadline: action.reveal.revealDeadline,
          options: null,
          answerDeadline: null,
          minAnswerAt: null,
          resolution: null,
        },
      };
    case 'ROUND_OPTIONS':
      if (!state.round || state.round.roundId !== action.options.roundId) return state; // stale/out-of-order event
      return {
        ...state,
        round: {
          ...state.round,
          options: action.options.options,
          answerDeadline: action.options.answerDeadline,
          minAnswerAt: action.options.minAnswerAt,
        },
      };
    case 'ROUND_ANSWERED':
      if (!state.round || state.round.roundId !== action.roundId) return state;
      return {
        ...state,
        round: { ...state.round, resolution: { correct: action.correct, correctToken: action.correctToken, pickedToken: action.pickedToken } },
      };
    case 'ROUND_TIMEOUT':
      if (!state.round || state.round.roundId !== action.timeout.roundId) return state;
      return {
        ...state,
        round: { ...state.round, resolution: { correct: false, correctToken: action.timeout.correctToken, pickedToken: null } },
      };
    case 'MATCH_END':
      return { ...state, stage: 'result', matchResult: action.result, round: null };
    case 'RESET_TO_LOBBY':
      return { ...state, stage: 'lobby', room: null, matchResult: null, round: null };
    case 'VIEW_PROFILE':
      return { ...state, stage: 'profile', error: null };
    case 'LOGOUT':
      return { ...initialState, bootstrapping: false };
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

/** A fresh random id per financial button-press, so a dropped response followed by a
 *  retry (or an accidental double-click landing two requests) can never double the
 *  effect — the server treats repeats of the same id as one operation (see wallet.ts). */
function newRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useArena() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const userRef = useRef<ArenaUser | null>(null);
  const roomRef = useRef<RoomStatePublic | null>(null);
  const roomsRef = useRef<RoomSummary[]>([]);
  const roundRef = useRef<ActiveRoundView | null>(null);
  useEffect(() => {
    userRef.current = state.user;
    roomRef.current = state.room;
    roomsRef.current = state.rooms;
    roundRef.current = state.round;
  }, [state.user, state.room, state.rooms, state.round]);

  // --- Bootstrap: ask the server (via the httpOnly session cookie) whether we're already
  // logged in. There is no client-side identity cache anymore — a stored user id/name in
  // localStorage was itself part of the audited trust-model problem, so the browser now
  // holds no opinion about who is logged in beyond what the server's session says. ------
  useEffect(() => {
    let cancelled = false;
    void fetchMe()
      .then((user) => {
        if (!cancelled) dispatch({ type: 'BOOTSTRAP_DONE', user });
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: 'BOOTSTRAP_DONE', user: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // --- Socket event wiring — only ever connects once we actually have an authenticated
  // session; the server would reject an unauthenticated socket anyway (see socket.ts). ---
  useEffect(() => {
    if (!state.user) return;
    const socket = getArenaSocket();

    const onRoomUpdate = (room: RoomStatePublic) => dispatch({ type: 'ROOM_UPDATE', room });
    const onReveal = (reveal: RoundRevealPublic) => dispatch({ type: 'ROUND_REVEAL', reveal });
    const onOptions = (options: RoundOptionsPublic) => dispatch({ type: 'ROUND_OPTIONS', options });
    const onTimeout = (timeout: RoundTimeoutPublic) => dispatch({ type: 'ROUND_TIMEOUT', timeout });
    const onMatchEnd = (result: MatchResultPublic) => {
      dispatch({ type: 'MATCH_END', result });
      // Wallet balance changed (entry fee + possible payout already applied server-side) — pull the fresh number.
      void fetchWallet().then((user) => dispatch({ type: 'WALLET_REFRESHED', user }));
    };

    socket.on('room:update', onRoomUpdate);
    socket.on('match:round:reveal', onReveal);
    socket.on('match:round:options', onOptions);
    socket.on('match:round:timeout', onTimeout);
    socket.on('match:end', onMatchEnd);

    return () => {
      socket.off('room:update', onRoomUpdate);
      socket.off('match:round:reveal', onReveal);
      socket.off('match:round:options', onOptions);
      socket.off('match:round:timeout', onTimeout);
      socket.off('match:end', onMatchEnd);
    };
  }, [state.user]);

  const login = useCallback(async (name: string, password: string) => {
    dispatch({ type: 'LOGIN_START' });
    try {
      const user = await apiLogin(name, password);
      dispatch({ type: 'LOGIN_SUCCESS', user });
    } catch (err) {
      dispatch({ type: 'LOGIN_IDLE' });
      throw err instanceof Error ? err : new Error('Login failed');
    }
  }, []);

  const signup = useCallback(async (name: string, password: string) => {
    dispatch({ type: 'LOGIN_START' });
    try {
      const user = await apiSignup(name, password);
      dispatch({ type: 'LOGIN_SUCCESS', user });
    } catch (err) {
      dispatch({ type: 'LOGIN_IDLE' });
      throw err instanceof Error ? err : new Error('Sign up failed');
    }
  }, []);

  const refreshRooms = useCallback(async () => {
    try {
      const rooms = await fetchRooms();
      dispatch({ type: 'ROOMS_LIST', rooms });
    } catch {
      // Transient network hiccup while polling the lobby — next poll will retry.
    }
  }, []);

  const topUp = useCallback(async (amount: number) => {
    try {
      const user = await topUpWallet(amount, newRequestId());
      dispatch({ type: 'WALLET_REFRESHED', user });
    } catch (err) {
      dispatch({ type: 'ERROR', error: err instanceof Error ? err.message : 'Deposit failed' });
    }
  }, []);

  const withdraw = useCallback(async (amount: number) => {
    try {
      const user = await withdrawWallet(amount, newRequestId());
      dispatch({ type: 'WALLET_REFRESHED', user });
    } catch (err) {
      dispatch({ type: 'ERROR', error: err instanceof Error ? err.message : 'Withdrawal failed' });
    }
  }, []);

  /**
   * Casino-style "pick a stake and play" flow: seats the player at an existing open
   * table for this entry fee + format if one has room, otherwise opens a fresh table —
   * the player never has to think about individual room ids or a separate create step.
   * Neither emit below includes a userId — the server identifies the caller from their
   * authenticated socket connection alone.
   */
  const playAtFee = useCallback(async (entryFee: number, format: RoomFormat) => {
    if (!userRef.current) return;
    dispatch({ type: 'BUSY', busy: true });

    const openTable = roomsRef.current.find(
      (r) => r.entryFee === entryFee && r.format === format && r.status === 'waiting' && r.playerCount < r.maxPlayers,
    );

    if (openTable) {
      const joinAck = await emitAck<{ ok: boolean; room?: RoomStatePublic; error?: string }>('rooms:join', { roomId: openTable.id });
      if (joinAck.ok && joinAck.room) {
        dispatch({ type: 'JOIN_ROOM_SUCCESS', room: joinAck.room });
        return;
      }
      // The table filled up (or vanished) between the last poll and this click —
      // fall through and open a brand new table instead of surfacing an error.
    }

    const createAck = await emitAck<{ ok: boolean; roomId?: string; error?: string }>('rooms:create', { gameKind: 'memoryMatch', entryFee, format });
    if (!createAck.ok || !createAck.roomId) {
      dispatch({ type: 'ERROR', error: createAck.error ?? 'Could not start a table' });
      return;
    }
    const joinAck = await emitAck<{ ok: boolean; room?: RoomStatePublic; error?: string }>('rooms:join', { roomId: createAck.roomId });
    if (!joinAck.ok || !joinAck.room) {
      dispatch({ type: 'ERROR', error: joinAck.error ?? 'Could not join the table' });
      return;
    }
    dispatch({ type: 'JOIN_ROOM_SUCCESS', room: joinAck.room });
  }, []);

  const leaveRoom = useCallback(async () => {
    const room = roomRef.current;
    if (!room) {
      dispatch({ type: 'LEAVE_ROOM' });
      return;
    }
    await emitAck('rooms:leave', { roomId: room.id });
    const refreshed = await fetchWallet().catch(() => null);
    if (refreshed) dispatch({ type: 'WALLET_REFRESHED', user: refreshed });
    dispatch({ type: 'LEAVE_ROOM' });
  }, []);

  const setReady = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    await emitAck('rooms:ready', { roomId: room.id });
  }, []);

  /** `optionToken` is the opaque token the server assigned this specific option in
   *  `match:round:options` — never an index, never anything the client derives itself. */
  const submitAnswer = useCallback(async (optionToken: string) => {
    const room = roomRef.current;
    const round = roundRef.current;
    if (!room || !round || round.resolution) return;
    const ack = await emitAck<{ ok: boolean; correct?: boolean; correctToken?: string; error?: string }>('match:answer', {
      roomId: room.id,
      roundId: round.roundId,
      optionToken,
    });
    if (ack.ok && ack.correct !== undefined && ack.correctToken !== undefined) {
      dispatch({ type: 'ROUND_ANSWERED', roundId: round.roundId, correct: ack.correct, correctToken: ack.correctToken, pickedToken: optionToken });
    } else if (!ack.ok && ack.error) {
      // Surfaced so a genuinely confusing rejection (e.g. clock skew) isn't silent — most
      // rejections in normal play are prevented client-side before this point (see
      // RoomScreen's minAnswerAt gating) so this should rarely fire in honest play.
      dispatch({ type: 'ERROR', error: ack.error });
    }
  }, []);

  const backToLobby = useCallback(() => {
    dispatch({ type: 'RESET_TO_LOBBY' });
  }, []);

  const goToProfile = useCallback(() => {
    dispatch({ type: 'VIEW_PROFILE' });
  }, []);

  /** Signs the player out: tells the server to invalidate the session (so the cookie is
   *  useless even if it somehow leaked), tears down the live socket connection, and resets
   *  all client state back to the login screen. */
  const logout = useCallback(async () => {
    disconnectArenaSocket();
    await apiLogout().catch(() => {
      // Even if the network call fails, still forget the session client-side.
    });
    dispatch({ type: 'LOGOUT' });
  }, []);

  const clearError = useCallback(() => dispatch({ type: 'ERROR', error: null }), []);

  return {
    state,
    login,
    signup,
    refreshRooms,
    topUp,
    withdraw,
    playAtFee,
    leaveRoom,
    setReady,
    submitAnswer,
    backToLobby,
    goToProfile,
    logout,
    clearError,
  };
}
