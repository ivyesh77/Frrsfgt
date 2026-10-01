import { useCallback, useEffect, useReducer, useRef } from 'react';
import { fetchGameModes, fetchMe, fetchRooms, fetchWallet, login as apiLogin, logout as apiLogout, setUnauthorizedHandler, signup as apiSignup, topUpWallet, withdrawWallet } from './api';
import { disconnectArenaSocket, getArenaSocket } from './socket';
import { sounds } from './sound';
import { haptics } from './haptics';
import type {
  ArenaUser,
  GameModeMeta,
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
   *  timed out) — `pickedToken` is null for a timeout. `scoreAfter` is the server's own
   *  authoritative score right after this round resolved, never computed client-side. */
  resolution: { correct: boolean; correctToken: string; pickedToken: string | null; scoreAfter: number } | null;
}

interface ArenaState {
  stage: ArenaStage;
  user: ArenaUser | null;
  authenticating: boolean;
  bootstrapping: boolean;
  rooms: RoomSummary[];
  /** Which room formats (duel/squad) are actually enabled right now — real server config,
   *  fetched from GET /api/game-modes. Starts empty; the Play screen shows an honest
   *  loading/empty state rather than assuming both are enabled before this resolves. */
  gameModes: GameModeMeta[];
  room: RoomStatePublic | null;
  round: ActiveRoundView | null;
  matchResult: MatchResultPublic | null;
  error: string | null;
  notice: string | null;
  busy: boolean;
  /** Bumped every time a fresh `match:found` event arrives, purely so the matchmaking
   *  screen can key a one-shot entrance animation off of it instead of re-playing on every
   *  incidental room:update. */
  matchFoundToken: number;
  /** Bumped every time a real match actually finishes — screens like the dashboard's
   *  "recent matches" preview use this purely to know when to refetch, never as data itself. */
  activityToken: number;
}

type Action =
  | { type: 'BOOTSTRAP_DONE'; user: ArenaUser | null }
  | { type: 'LOGIN_START' }
  | { type: 'LOGIN_SUCCESS'; user: ArenaUser }
  | { type: 'LOGIN_ERROR'; error: string }
  | { type: 'LOGIN_IDLE' }
  | { type: 'WALLET_REFRESHED'; user: ArenaUser }
  | { type: 'ROOMS_LIST'; rooms: RoomSummary[] }
  | { type: 'GAME_MODES'; modes: GameModeMeta[] }
  | { type: 'BUSY'; busy: boolean }
  | { type: 'JOIN_ROOM_SUCCESS'; room: RoomStatePublic }
  | { type: 'MATCH_FOUND'; room: RoomStatePublic }
  | { type: 'ROOM_UPDATE'; room: RoomStatePublic }
  | { type: 'MATCH_CANCELLED'; reason: string }
  | { type: 'LEAVE_ROOM' }
  | { type: 'ROUND_REVEAL'; reveal: RoundRevealPublic }
  | { type: 'ROUND_OPTIONS'; options: RoundOptionsPublic }
  | { type: 'ROUND_ANSWERED'; roundId: string; correct: boolean; correctToken: string; pickedToken: string; score: number }
  | { type: 'ROUND_TIMEOUT'; timeout: RoundTimeoutPublic }
  | { type: 'MATCH_END'; result: MatchResultPublic }
  | { type: 'RESET_TO_LOBBY' }
  | { type: 'VIEW_PROFILE' }
  | { type: 'LOGOUT' }
  | { type: 'SESSION_EXPIRED' }
  | { type: 'ERROR'; error: string | null }
  | { type: 'DISMISS_NOTICE' };

const initialState: ArenaState = {
  stage: 'login',
  user: null,
  authenticating: false,
  bootstrapping: true,
  rooms: [],
  gameModes: [],
  room: null,
  round: null,
  matchResult: null,
  error: null,
  notice: null,
  busy: false,
  matchFoundToken: 0,
  activityToken: 0,
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
    case 'GAME_MODES':
      return { ...state, gameModes: action.modes };
    case 'BUSY':
      return { ...state, busy: action.busy };
    case 'JOIN_ROOM_SUCCESS':
      return { ...state, stage: 'room', room: action.room, busy: false, error: null, round: null, matchResult: null };
    case 'MATCH_FOUND':
      // A fresh room-scoped id just filled up — play the "match found" entrance once.
      if (state.room && state.room.id === action.room.id) return { ...state, room: action.room };
      return { ...state, stage: 'room', room: action.room, matchFoundToken: state.matchFoundToken + 1 };
    case 'ROOM_UPDATE': {
      // A resumed/late room:update (e.g. after a page refresh mid-match, or the server
      // silently re-attaching a reconnecting socket) should bring the player straight back
      // into the room view rather than leaving them stranded on the lobby screen.
      if (action.room.status === 'finished' || action.room.status === 'cancelled') {
        if (!state.room || state.room.id !== action.room.id) return state;
        return { ...state, room: action.room };
      }
      return { ...state, room: action.room, stage: 'room' };
    }
    case 'MATCH_CANCELLED':
      return { ...state, stage: 'lobby', room: null, round: null, matchResult: null, notice: 'Your match was cancelled and your entry fee was refunded — not everyone readied up in time.' };
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
        round: {
          ...state.round,
          resolution: { correct: action.correct, correctToken: action.correctToken, pickedToken: action.pickedToken, scoreAfter: action.score },
        },
      };
    case 'ROUND_TIMEOUT':
      if (!state.round || state.round.roundId !== action.timeout.roundId) return state;
      return {
        ...state,
        round: { ...state.round, resolution: { correct: false, correctToken: action.timeout.correctToken, pickedToken: null, scoreAfter: action.timeout.score } },
      };
    case 'MATCH_END':
      return { ...state, stage: 'result', matchResult: action.result, round: null, activityToken: state.activityToken + 1 };
    case 'RESET_TO_LOBBY':
      return { ...state, stage: 'lobby', room: null, matchResult: null, round: null };
    case 'VIEW_PROFILE':
      return { ...state, stage: 'profile', error: null };
    case 'LOGOUT':
      return { ...initialState, bootstrapping: false };
    case 'SESSION_EXPIRED':
      return { ...initialState, bootstrapping: false, error: 'Your session expired — please sign in again.' };
    case 'ERROR':
      return { ...state, error: action.error, busy: false };
    case 'DISMISS_NOTICE':
      return { ...state, notice: null };
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
  const roundRef = useRef<ActiveRoundView | null>(null);
  useEffect(() => {
    userRef.current = state.user;
    roomRef.current = state.room;
    roundRef.current = state.round;
  }, [state.user, state.room, state.round]);

  // --- Any REST call that needed an authenticated session but got a 401 back (session
  // expired/revoked server-side, e.g. a restart) now bounces here instead of leaving a raw
  // "Not authenticated" error stranded on whichever screen asked first (Stats, Achievements,
  // Wallet, ...). Guarded on userRef so this can never misfire for the ordinary, expected 401
  // a bad-password login/signup attempt returns before any session exists yet. -------------
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (!userRef.current) return; // never logged in this tab yet — not a real expiry
      disconnectArenaSocket();
      dispatch({ type: 'SESSION_EXPIRED' });
    });
    return () => setUnauthorizedHandler(null);
  }, []);

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
  // session; the server would reject an unauthenticated socket anyway (see socket.ts).
  // Connecting (or reconnecting, e.g. after a page refresh or brief network drop) triggers
  // the server to silently re-attach this socket to whatever match the account was already
  // authoritatively part of and push a fresh `room:update` — that's what lets a genuine
  // mid-match reconnect resume seamlessly without the client asking for anything. ---------
  useEffect(() => {
    if (!state.user) return;
    const socket = getArenaSocket();

    // If the socket's session cookie is ever stale/invalid by the time it reaches the
    // server (e.g. the server process restarted since this tab logged in, or the session
    // simply expired), the server's io.use() middleware rejects the handshake outright.
    // Without handling this, every subsequent emit (queue:join, rooms:ready, ...) would
    // just sit forever waiting for an ack that will never come — from the player's
    // perspective, clicking "Find Match" would silently do nothing. Instead, treat it the
    // same as being logged out: bounce back to the login screen with a clear message so
    // the user can sign back in and get a fresh, valid session immediately.
    const onConnectError = (err: Error) => {
      if (err.message !== 'Unauthorized') return; // transient network hiccup — socket.io will retry on its own
      disconnectArenaSocket();
      dispatch({ type: 'SESSION_EXPIRED' });
    };
    socket.on('connect_error', onConnectError);

    const onRoomUpdate = (room: RoomStatePublic) => dispatch({ type: 'ROOM_UPDATE', room });
    const onMatchFound = (room: RoomStatePublic) => {
      dispatch({ type: 'MATCH_FOUND', room });
      if (room.status === 'ready_check') {
        sounds.matchFound();
        haptics.matchFound();
      }
    };
    const onMatchCancelled = (payload: { reason: string }) => dispatch({ type: 'MATCH_CANCELLED', reason: payload.reason });
    const onReveal = (reveal: RoundRevealPublic) => dispatch({ type: 'ROUND_REVEAL', reveal });
    const onOptions = (options: RoundOptionsPublic) => dispatch({ type: 'ROUND_OPTIONS', options });
    const onTimeout = (timeout: RoundTimeoutPublic) => {
      dispatch({ type: 'ROUND_TIMEOUT', timeout });
      sounds.wrong();
      haptics.wrong();
    };
    const onMatchEnd = (result: MatchResultPublic) => {
      dispatch({ type: 'MATCH_END', result });
      const mine = result.results.find((r) => r.id === userRef.current?.id);
      if (result.isDraw || result.isVoidMatch) {
        sounds.neutral();
      } else if (mine?.isWinner) {
        sounds.win();
        haptics.win();
      } else {
        sounds.lose();
        haptics.lose();
      }
      // Wallet balance changed (entry fee + possible payout/refund already applied server-side) — pull the fresh number.
      void fetchWallet().then((user) => dispatch({ type: 'WALLET_REFRESHED', user }));
    };

    socket.on('room:update', onRoomUpdate);
    socket.on('match:found', onMatchFound);
    socket.on('match:cancelled', onMatchCancelled);
    socket.on('match:round:reveal', onReveal);
    socket.on('match:round:options', onOptions);
    socket.on('match:round:timeout', onTimeout);
    socket.on('match:end', onMatchEnd);

    return () => {
      socket.off('connect_error', onConnectError);
      socket.off('room:update', onRoomUpdate);
      socket.off('match:found', onMatchFound);
      socket.off('match:cancelled', onMatchCancelled);
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

  const refreshGameModes = useCallback(async () => {
    try {
      const { modes } = await fetchGameModes();
      dispatch({ type: 'GAME_MODES', modes });
    } catch {
      // Transient network hiccup — the Play screen keeps whatever it last knew.
    }
  }, []);

  // Deliberately RE-THROW on failure (unlike most other actions here) rather than only
  // dispatching the global error toast — the Wallet screen's deposit/withdraw forms show
  // the failure inline, right next to the amount the player just tried, which is far
  // clearer for a financial action than a toast at the top of the screen. Success is only
  // ever reported by the caller after this promise genuinely resolves with the server's
  // own updated balance — never assumed.
  const topUp = useCallback(async (amount: number) => {
    const user = await topUpWallet(amount, newRequestId());
    dispatch({ type: 'WALLET_REFRESHED', user });
  }, []);

  const withdraw = useCallback(async (amount: number) => {
    const user = await withdrawWallet(amount, newRequestId());
    dispatch({ type: 'WALLET_REFRESHED', user });
  }, []);

  /**
   * The ONLY way into a match: ask the server's own matchmaking queue for this stake +
   * format. There is no client-side "look for an open table, else create one" logic
   * anymore — the client never picks a room id, never decides who it's paired with, and
   * never learns about a room until the server pushes one back. This is what makes
   * "join an unauthorized/arbitrary match" structurally impossible rather than merely
   * checked: there is no room-id parameter left for a client to forge.
   */
  const joinQueue = useCallback(async (entryFee: number, format: RoomFormat) => {
    if (!userRef.current) return;
    dispatch({ type: 'BUSY', busy: true });
    const ack = await emitAck<{ ok: boolean; room?: RoomStatePublic; error?: string }>('queue:join', {
      gameKind: 'memoryMatch',
      entryFee,
      format,
    });
    if (!ack.ok || !ack.room) {
      dispatch({ type: 'ERROR', error: ack.error ?? 'Could not join matchmaking' });
      return;
    }
    dispatch({ type: 'JOIN_ROOM_SUCCESS', room: ack.room });
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
    const ack = await emitAck<{ ok: boolean; correct?: boolean; correctToken?: string; score?: number; error?: string }>('match:answer', {
      roomId: room.id,
      roundId: round.roundId,
      optionToken,
    });
    if (ack.ok && ack.correct !== undefined && ack.correctToken !== undefined && ack.score !== undefined) {
      dispatch({ type: 'ROUND_ANSWERED', roundId: round.roundId, correct: ack.correct, correctToken: ack.correctToken, pickedToken: optionToken, score: ack.score });
      if (ack.correct) {
        sounds.correct();
        haptics.correct();
      } else {
        sounds.wrong();
        haptics.wrong();
      }
    } else if (!ack.ok && ack.error) {
      // Surfaced so a genuinely confusing rejection (e.g. clock skew) isn't silent — most
      // rejections in normal play are prevented client-side before this point (see
      // RoomScreen's minAnswerAt gating) so this should rarely fire in honest play.
      dispatch({ type: 'ERROR', error: ack.error });
    }
  }, []);

  /** REMATCH sends a request to the server; the server alone decides whether a rematch can
   *  be created (only from a match this account just finished) and re-runs the player
   *  through the exact same matchmaking queue path as any other join — never a
   *  client-only/locally-fabricated room. */
  const requestRematch = useCallback(async () => {
    dispatch({ type: 'BUSY', busy: true });
    const ack = await emitAck<{ ok: boolean; room?: RoomStatePublic; error?: string }>('match:rematch', {});
    if (!ack.ok || !ack.room) {
      dispatch({ type: 'ERROR', error: ack.error ?? 'Could not start a rematch' });
      return;
    }
    dispatch({ type: 'JOIN_ROOM_SUCCESS', room: ack.room });
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
  const dismissNotice = useCallback(() => dispatch({ type: 'DISMISS_NOTICE' }), []);

  return {
    state,
    login,
    signup,
    refreshRooms,
    refreshGameModes,
    topUp,
    withdraw,
    joinQueue,
    leaveRoom,
    setReady,
    submitAnswer,
    requestRematch,
    backToLobby,
    goToProfile,
    logout,
    clearError,
    dismissNotice,
  };
}
