import type { AssetMetadata, GamePhase, GameResult, Round, RoundOutcome, RoundResult, ScoreState } from '../../types';
import { generateRound, pushHistory } from './roundGenerator';
import { applyRoundResult, computeRoundPoints, createInitialScoreState } from './scoring';
import {
  FEEDBACK_CORRECT_MS,
  FEEDBACK_TIMEOUT_MS,
  FEEDBACK_WRONG_MS,
  NEXT_ROUND_GAP_MS,
  TARGET_HIDE_MS,
  TARGET_REVEAL_MS,
  TOTAL_ROUNDS,
} from './constants';

const ANSWER_SELECTED_MS = 180;

export interface GameEngineState {
  phase: GamePhase;
  phaseStartedAt: number;
  phaseDuration: number;
  round: Round | null;
  roundNumber: number;
  score: ScoreState;
  history: string[];
  selectedPosition: number | null;
  pendingOutcome: RoundOutcome | null;
  lastRoundResult: RoundResult | null;
  gameResult: GameResult | null;
  answerWindowStartedAt: number | null;
  sessionStartedAt: number | null;
  resumePhase: GamePhase | null;
  pausedRemaining: number | null;
}

export type GameEngineAction =
  | { type: 'START_GAME'; now: number; assets: AssetMetadata[] }
  | { type: 'ADVANCE'; now: number; assets: AssetMetadata[] }
  | { type: 'SELECT_ANSWER'; position: number; responseMs: number; now: number }
  | { type: 'ANSWER_TIMEOUT'; now: number }
  | { type: 'RETURN_TO_MENU' }
  | { type: 'VISIBILITY_HIDDEN'; now: number }
  | { type: 'VISIBILITY_VISIBLE'; now: number }
  | { type: 'SET_GAME_RESULT'; result: GameResult };

export function createInitialEngineState(): GameEngineState {
  return {
    phase: 'MENU',
    phaseStartedAt: 0,
    phaseDuration: 0,
    round: null,
    roundNumber: 0,
    score: createInitialScoreState(),
    history: [],
    selectedPosition: null,
    pendingOutcome: null,
    lastRoundResult: null,
    gameResult: null,
    answerWindowStartedAt: null,
    sessionStartedAt: null,
    resumePhase: null,
    pausedRemaining: null,
  };
}

function startRound(
  roundNumber: number,
  history: string[],
  assets: AssetMetadata[],
  now: number,
  score: ScoreState,
  sessionStartedAt: number | null,
): GameEngineState {
  const round = generateRound(roundNumber, assets, history);
  return {
    phase: 'TARGET_REVEAL',
    phaseStartedAt: now,
    phaseDuration: TARGET_REVEAL_MS,
    round,
    roundNumber,
    score,
    history,
    selectedPosition: null,
    pendingOutcome: null,
    lastRoundResult: null,
    gameResult: null,
    answerWindowStartedAt: null,
    sessionStartedAt,
    resumePhase: null,
    pausedRemaining: null,
  };
}

/** Pausable phases: those where an active countdown affects fairness or pacing. */
const TIMED_PHASES = new Set<GamePhase>([
  'TARGET_REVEAL',
  'MEMORIZING',
  'TARGET_HIDDEN',
  'ANSWERING',
  'ANSWER_SELECTED',
  'FEEDBACK_CORRECT',
  'FEEDBACK_WRONG',
  'FEEDBACK_TIMEOUT',
  'NEXT_ROUND',
]);

function finishAnswering(
  state: GameEngineState,
  outcome: RoundOutcome,
  selectedPosition: number | null,
  responseMs: number | null,
  now: number,
): GameEngineState {
  if (!state.round) return state;
  const streakAfter = outcome === 'correct' ? state.score.streak + 1 : 0;
  const points = computeRoundPoints({
    outcome,
    responseMs,
    answerMs: state.round.answerMs,
    streakAfter,
    scoreMultiplier: state.round.scoreMultiplier,
  });
  const nextScore = applyRoundResult(state.score, outcome, responseMs, points);
  const result: RoundResult = {
    round: state.roundNumber,
    outcome,
    responseMs,
    pointsEarned: points,
    selectedPosition,
  };

  return {
    ...state,
    phase: 'ANSWER_SELECTED',
    phaseStartedAt: now,
    phaseDuration: ANSWER_SELECTED_MS,
    selectedPosition,
    pendingOutcome: outcome,
    score: nextScore,
    lastRoundResult: result,
  };
}

export function gameReducer(state: GameEngineState, action: GameEngineAction): GameEngineState {
  switch (action.type) {
    case 'START_GAME': {
      return startRound(1, [], action.assets, action.now, createInitialScoreState(), action.now);
    }

    case 'RETURN_TO_MENU': {
      return createInitialEngineState();
    }

    case 'SELECT_ANSWER': {
      if (state.phase !== 'ANSWERING' || !state.round) return state; // input already locked
      const option = state.round.options[action.position];
      const outcome: RoundOutcome = option?.isCorrect ? 'correct' : 'wrong';
      return finishAnswering(state, outcome, action.position, action.responseMs, action.now);
    }

    case 'ANSWER_TIMEOUT': {
      if (state.phase !== 'ANSWERING') return state;
      return finishAnswering(state, 'timeout', null, null, action.now);
    }

    case 'VISIBILITY_HIDDEN': {
      if (!TIMED_PHASES.has(state.phase)) return state;
      const elapsed = action.now - state.phaseStartedAt;
      const remaining = Math.max(0, state.phaseDuration - elapsed);
      return {
        ...state,
        resumePhase: state.phase,
        pausedRemaining: remaining,
        phase: 'PAUSED',
      };
    }

    case 'VISIBILITY_VISIBLE': {
      if (state.phase !== 'PAUSED' || state.resumePhase === null) return state;
      return {
        ...state,
        phase: state.resumePhase,
        phaseStartedAt: action.now,
        phaseDuration: state.pausedRemaining ?? 0,
        resumePhase: null,
        pausedRemaining: null,
      };
    }

    case 'ADVANCE': {
      switch (state.phase) {
        case 'TARGET_REVEAL': {
          if (!state.round) return state;
          return { ...state, phase: 'MEMORIZING', phaseStartedAt: action.now, phaseDuration: state.round.memorizeMs };
        }
        case 'MEMORIZING': {
          return { ...state, phase: 'TARGET_HIDDEN', phaseStartedAt: action.now, phaseDuration: TARGET_HIDE_MS };
        }
        case 'TARGET_HIDDEN': {
          if (!state.round) return state;
          return {
            ...state,
            phase: 'ANSWERING',
            phaseStartedAt: action.now,
            phaseDuration: state.round.answerMs,
            answerWindowStartedAt: action.now,
          };
        }
        case 'ANSWER_SELECTED': {
          const feedbackPhase: GamePhase =
            state.pendingOutcome === 'correct'
              ? 'FEEDBACK_CORRECT'
              : state.pendingOutcome === 'timeout'
                ? 'FEEDBACK_TIMEOUT'
                : 'FEEDBACK_WRONG';
          const duration =
            feedbackPhase === 'FEEDBACK_CORRECT'
              ? FEEDBACK_CORRECT_MS
              : feedbackPhase === 'FEEDBACK_TIMEOUT'
                ? FEEDBACK_TIMEOUT_MS
                : FEEDBACK_WRONG_MS;
          return { ...state, phase: feedbackPhase, phaseStartedAt: action.now, phaseDuration: duration };
        }
        case 'FEEDBACK_CORRECT':
        case 'FEEDBACK_WRONG':
        case 'FEEDBACK_TIMEOUT': {
          return { ...state, phase: 'NEXT_ROUND', phaseStartedAt: action.now, phaseDuration: NEXT_ROUND_GAP_MS };
        }
        case 'NEXT_ROUND': {
          if (!state.round) return state;
          const nextHistory = pushHistory(state.history, state.round.target.id);
          if (state.roundNumber >= TOTAL_ROUNDS) {
            return {
              ...state,
              phase: 'GAME_COMPLETE',
              phaseStartedAt: action.now,
              phaseDuration: 0,
              gameResult: null,
              round: null,
            };
          }
          return startRound(
            state.roundNumber + 1,
            nextHistory,
            action.assets,
            action.now,
            state.score,
            state.sessionStartedAt,
          );
        }
        default:
          return state;
      }
    }

    case 'SET_GAME_RESULT': {
      return { ...state, gameResult: action.result };
    }

    default:
      return state;
  }
}
