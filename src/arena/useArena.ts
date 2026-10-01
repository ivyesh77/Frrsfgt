import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { fetchGameModes, fetchRooms, fetchWallet, topUpWallet, withdrawWallet } from './api';
import { authStore, useAuthState } from './authStore';
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

/** The game-navigation-only subset of ArenaStage — 'login' is never stored here, it is
 *  always derived from auth status (see useArena() below), so there is exactly one place
 *  that can ever decide "show the login screen" instead of two independent opinions. */
type GameStage = Exclude<ArenaStage, 'login'>;

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

/**
 * Purely the GAME/NAVIGATION slice now — login/logout/session-expiry/bootstrap state lives
 * exclusively in authStore.ts (see that file's top comment for why this was split out).
 * `useArena()` below combines the two for backwards-compatible consumption by ArenaApp.tsx.
 */
interface ArenaState {
  stage: GameStage;
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
  | { type: 'RESET_GAME_STATE' }
  | { type: 'ERROR'; error: string | null }
  | { type: 'DISMISS_NOTICE' };

const initialState: ArenaState = {
  stage: 'lobby',
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
    case 'RESET_GAME_STATE':
      // Fired whenever auth transitions away from 'authenticated' (explicit logout, or a
      // confirmed session expiry) — the game/navigation slice has no business remembering
      // a stale room/rooms-list/match-result from the previous account once that happens.
      return { ...initialState };
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
  // Auth/session truth lives entirely in authStore.ts now (see that file's top comment) —
  // this hook just subscribes to it. There is no more local bootstrap/login/logout/401
  // handling logic duplicated here; `auth.user`/`auth.status` are the only things this
  // file ever reads to know who (if anyone) is logged in.
  const auth = useAuthState();
  const [authenticating, setAuthenticating] = useState(false);

  const [state, dispatch] = useReducer(reducer, initialState);
  const userRef = useRef<ArenaUser | null>(null);
  const roomRef = useRef<RoomStatePublic | null>(null);
  const roundRef = useRef<ActiveRoundView | null>(null);
  useEffect(() => {
    userRef.current = auth.user;
    roomRef.current = state.room;
    roundRef.current = state.round;
  }, [auth.user, state.room, state.round]);

  // The game/navigation slice has no business surviving a logout or a confirmed session
  // expiry from a previous account — reset it the moment auth stops being 'authenticated'.
  const wasAuthenticated = useRef(false);
  useEffect(() => {
    if (auth.status === 'authenticated') {
      wasAuthenticated.current = true;
    } else if (wasAuthenticated.current) {
      wasAuthenticated.current = false;
      disconnectArenaSocket();
      dispatch({ type: 'RESET_GAME_STATE' });
    }
  }, [auth.status]);

  // --- Bootstrap: ask the server (via the httpOnly session cookie / bearer token) whether
  // we're already logged in. Exactly one call, on mount — see authStore.bootstrap(). There
  // is no client-side identity cache: the browser holds no opinion about who is logged in
  // beyond what the server's session says. ------------------------------------------------
  useEffect(() => {
    void authStore.bootstrap();
    // Mount-only: this is the one-time "are we already logged in?" check on page load.
  }, []);

  const retryBootstrap = useCallback(() => {
    authStore.retryBootstrap();
  }, []);

  // --- Socket event wiring — only ever connects once we actually have an authenticated
  // session; the server would reject an unauthenticated socket anyway (see socket.ts).
  // Connecting (or reconnecting, e.g. after a page refresh or brief network drop) triggers
  // the server to silently re-attach this socket to whatever match the account was already
  // authoritatively part of and push a fresh `room:update` — that's what lets a genuine
  // mid-match reconnect resume seamlessly without the client asking for anything. ---------
  useEffect(() => {
    if (auth.status !== 'authenticated') return;
    const socket = getArenaSocket();

    // If the socket's session cookie/token is ever stale/invalid by the time it reaches the
    // server (e.g. the server process restarted since this tab logged in, or the session
    // simply expired), the server's io.use() middleware rejects the handshake outright.
    // Without handling this, every subsequent emit (queue:join, rooms:ready, ...) would
    // just sit forever waiting for an ack that will never come — from the player's
    // perspective, clicking "Find Match" would silently do nothing. This does NOT
    // immediately log anyone out — it routes through the exact same confirmExpiryOrIgnore()
    // that a REST 401 does, so a transient hiccup (e.g. the socket racing a just-completed
    // login) is re-confirmed against the server before ever actually bouncing to login.
    const onConnectError = (err: Error) => {
      if (err.message !== 'Unauthorized') return; // transient network hiccup — socket.io will retry on its own
      void authStore.confirmExpiryOrIgnore();
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
      void fetchWallet().then((user) => authStore.updateUser(user));
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
  }, [auth.status]);

  // login()/signup() delegate entirely to authStore — the exact sequence required is:
  // call the real endpoint -> on success the store immediately reflects 'authenticated'
  // with the server's own returned user (verified identity, never an optimistic guess) ->
  // the bootstrap-time GET /me has ALREADY run before this screen was even reachable (the
  // login form cannot render until bootstrap resolves — see ArenaApp.tsx), so there is no
  // window where a stale pre-login check can race a fresh login. On failure the original
  // error is re-thrown as-is for AuthModal's own inline error display — never a generic
  // "session expired" message.
  const login = useCallback(async (name: string, password: string) => {
    setAuthenticating(true);
    try {
      await authStore.login(name, password);
    } finally {
      setAuthenticating(false);
    }
  }, []);

  const signup = useCallback(async (name: string, password: string) => {
    setAuthenticating(true);
    try {
      await authStore.signup(name, password);
    } finally {
      setAuthenticating(false);
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
    authStore.updateUser(user);
  }, []);

  const withdraw = useCallback(async (amount: number) => {
    const user = await withdrawWallet(amount, newRequestId());
    authStore.updateUser(user);
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
    if (refreshed) authStore.updateUser(refreshed);
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

  /** Signs the player out: tells the server to invalidate the session (so the cookie/token
   *  is useless even if it somehow leaked), tears down the live socket connection, and
   *  resets all client state back to the login screen. The game-state reset itself happens
   *  automatically via the `auth.status` effect above once authStore flips to
   *  'unauthenticated' — this just has to trigger that transition. */
  const logout = useCallback(async () => {
    await authStore.logout();
  }, []);

  const clearError = useCallback(() => {
    dispatch({ type: 'ERROR', error: null });
    authStore.clearExpiryReason();
  }, []);
  const dismissNotice = useCallback(() => dispatch({ type: 'DISMISS_NOTICE' }), []);

  // Backwards-compatible combined view for ArenaApp.tsx and everything downstream of it —
  // none of those components needed to change for this rewrite. `stage: 'login'` is now
  // ALWAYS derived from auth.status (never independently stored), so there is exactly one
  // place in the entire app that can ever decide "show the login screen".
  const combinedState = {
    ...state,
    stage: auth.status === 'authenticated' ? state.stage : ('login' as const),
    user: auth.user,
    authenticating,
    bootstrapping: auth.status === 'checking',
    bootstrapError: auth.status === 'error' ? auth.bootstrapError : null,
    // A confirmed session-expiry message takes priority over an ordinary game-error toast
    // (they're never both meaningful at the same time in practice — an expiry always also
    // resets the game slice back to its error-free initial state in the same tick).
    error: auth.expiryReason ?? state.error,
  };

  return {
    state: combinedState,
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
    retryBootstrap,
  };
}
