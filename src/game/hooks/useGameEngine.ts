import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { RefObject } from 'react';
import type { AssetMetadata, GameResult, Settings, StoredStats } from '../../types';
import { createInitialEngineState, gameReducer } from '../engine/gameReducer';
import { buildGameResult } from '../engine/scoring';
import { soundEngine } from '../../audio/soundEngine';
import { vibrate } from '../../utils/haptics';

const STREAK_MILESTONES = new Set([3, 5, 10, 15]);

export function useGameEngine(
  assets: AssetMetadata[],
  settings: Settings,
  statsRef: RefObject<StoredStats>,
  onGameComplete: (result: GameResult) => void,
) {
  const [state, dispatch] = useReducer(gameReducer, undefined, createInitialEngineState);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const prevPhaseRef = useRef(state.phase);
  const answerLockRef = useRef(false);

  // Drive every timed phase from a single timestamp-based scheduler instead of
  // relying on drifting intervals. Each phase re-schedules itself on change.
  useEffect(() => {
    if (state.phase === 'MENU' || state.phase === 'GAME_COMPLETE' || state.phase === 'PAUSED') return;
    if (state.phaseDuration <= 0) return;

    const elapsedAlready = performance.now() - state.phaseStartedAt;
    const remaining = Math.max(0, state.phaseDuration - elapsedAlready);

    const timeoutId = window.setTimeout(() => {
      const now = performance.now();
      if (state.phase === 'ANSWERING') {
        dispatch({ type: 'ANSWER_TIMEOUT', now });
      } else {
        dispatch({ type: 'ADVANCE', now, assets });
      }
    }, remaining);

    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.phaseStartedAt, state.phaseDuration, assets]);

  // Tab-visibility policy: pause the active countdown rather than letting it
  // run out of sync with what the player can actually see.
  useEffect(() => {
    function handleVisibility() {
      const now = performance.now();
      if (document.hidden) {
        dispatch({ type: 'VISIBILITY_HIDDEN', now });
      } else {
        dispatch({ type: 'VISIBILITY_VISIBLE', now });
      }
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  // Answer input lock: true only while an answer is being actively awaited.
  answerLockRef.current = state.phase !== 'ANSWERING';

  // One-shot audio/haptics per phase transition.
  useEffect(() => {
    if (prevPhaseRef.current === state.phase) return;
    const entered = state.phase;
    prevPhaseRef.current = state.phase;
    const s = settingsRef.current;

    if (entered === 'MEMORIZING') soundEngine.playReveal();
    if (entered === 'FEEDBACK_CORRECT') {
      soundEngine.playCorrect();
      if (s.haptics) vibrate(18);
      if (STREAK_MILESTONES.has(state.score.streak)) {
        window.setTimeout(() => soundEngine.playStreak(), 140);
      }
    }
    if (entered === 'FEEDBACK_WRONG') {
      soundEngine.playWrong();
      if (s.haptics) vibrate([0, 30, 40, 30]);
    }
    if (entered === 'FEEDBACK_TIMEOUT') {
      soundEngine.playTimeout();
      if (s.haptics) vibrate(30);
    }
  }, [state.phase, state.score.streak]);

  // Finalize the session exactly once when GAME_COMPLETE is reached.
  useEffect(() => {
    if (state.phase !== 'GAME_COMPLETE' || state.gameResult) return;
    const totalDurationMs = state.sessionStartedAt !== null ? performance.now() - state.sessionStartedAt : 0;
    const prevStats = statsRef.current;
    const result = buildGameResult(state.score, totalDurationMs, prevStats.bestScore, prevStats.bestStreak);
    dispatch({ type: 'SET_GAME_RESULT', result });
    soundEngine.playComplete();
    if (result.isNewBestScore) {
      window.setTimeout(() => soundEngine.playHighScore(), 260);
    }
    onGameComplete(result);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.gameResult, state.score, state.sessionStartedAt]);

  const startGame = useCallback(() => {
    soundEngine.unlock();
    soundEngine.playRoundStart();
    dispatch({ type: 'START_GAME', now: performance.now(), assets });
  }, [assets]);

  const selectAnswer = useCallback(
    (position: number) => {
      if (answerLockRef.current || !state.answerWindowStartedAt) return;
      const now = performance.now();
      soundEngine.playClick();
      dispatch({ type: 'SELECT_ANSWER', position, responseMs: now - state.answerWindowStartedAt, now });
    },
    [state.answerWindowStartedAt],
  );

  const returnToMenu = useCallback(() => {
    dispatch({ type: 'RETURN_TO_MENU' });
  }, []);

  const pause = useCallback(() => {
    dispatch({ type: 'VISIBILITY_HIDDEN', now: performance.now() });
  }, []);

  const resume = useCallback(() => {
    dispatch({ type: 'VISIBILITY_VISIBLE', now: performance.now() });
  }, []);

  return { state, startGame, selectAnswer, returnToMenu, pause, resume };
}
