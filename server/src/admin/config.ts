/**
 * Server-authoritative, admin-editable game configuration. This is the ONLY thing rooms.ts
 * consults for match timing/scoring/format-availability at runtime — the player client
 * never sends, and can never influence, any of these values.
 *
 * Layering (checked in this order, each one a strict superset of the fallback beneath it):
 *   1. An explicit runtime value an admin has set via PUT /admin/game/config (persisted in
 *      admin-store.json, survives a restart).
 *   2. Otherwise, exactly the same env-var-or-hardcoded-default values ../types.ts already
 *      exposed before the admin panel existed (ARCADE_MATCH_DURATION_MS, etc.) — this is
 *      what keeps the existing self-test suite's env-var overrides working completely
 *      unchanged; the admin layer is additive, not a replacement for that mechanism.
 */
import {
  getLobbyReadyTimeoutMs,
  getMatchDurationMs,
  getReadyCountdownMs,
  getReconnectGraceMs,
  getRoundAnswerMs,
  getRoundMemorizeMs,
} from '../types.js';
import type { AdminAccount, ConfigFieldHistory, GameConfig } from './types.js';
import { appendConfigHistory, getConfigHistory, getStoredGameConfig, setStoredGameConfig } from './store.js';

function defaultsFromEnv(): GameConfig {
  return {
    matchDurationMs: getMatchDurationMs(),
    readyCountdownMs: getReadyCountdownMs(),
    roundMemorizeMs: getRoundMemorizeMs(),
    roundAnswerMs: getRoundAnswerMs(),
    lobbyReadyTimeoutMs: getLobbyReadyTimeoutMs(),
    reconnectGraceMs: getReconnectGraceMs(),
    correctScoreDelta: 1,
    wrongPenaltyDelta: -1,
    duelEnabled: true,
    squadEnabled: true,
  };
}

/** The single source of truth every gameplay code path (rooms.ts) reads from. */
export function getEffectiveGameConfig(): GameConfig {
  const stored = getStoredGameConfig();
  if (!stored) return defaultsFromEnv();
  // Merge on top of env defaults so a config file saved before a new field existed never
  // produces `undefined` for that field after a code upgrade.
  return { ...defaultsFromEnv(), ...stored };
}

const CONFIG_BOUNDS: Record<keyof GameConfig, { min: number; max: number } | null> = {
  matchDurationMs: { min: 3_000, max: 10 * 60_000 },
  readyCountdownMs: { min: 1_000, max: 30_000 },
  roundMemorizeMs: { min: 300, max: 10_000 },
  roundAnswerMs: { min: 500, max: 20_000 },
  lobbyReadyTimeoutMs: { min: 5_000, max: 5 * 60_000 },
  reconnectGraceMs: { min: 2_000, max: 5 * 60_000 },
  correctScoreDelta: { min: 1, max: 100 },
  wrongPenaltyDelta: { min: -100, max: -1 },
  duelEnabled: null,
  squadEnabled: null,
};

export class InvalidConfigValueError extends Error {}

/** Applies a partial update, validating every field's bounds BEFORE writing anything (an
 *  all-or-nothing update — never leaves the config half-applied), and records one
 *  before/after history entry per field that actually changed. Returns the new effective
 *  config plus the list of fields that were actually changed (for the audit log). */
export function updateGameConfig(patch: Partial<GameConfig>, admin: AdminAccount): { config: GameConfig; changed: ConfigFieldHistory[] } {
  const current = getEffectiveGameConfig();
  const next: GameConfig = { ...current };
  const changed: ConfigFieldHistory[] = [];

  for (const key of Object.keys(patch) as (keyof GameConfig)[]) {
    const value = patch[key];
    if (value === undefined) continue;
    const bounds = CONFIG_BOUNDS[key];
    if (bounds && typeof value === 'number') {
      if (!Number.isFinite(value) || value < bounds.min || value > bounds.max) {
        throw new InvalidConfigValueError(`${key} must be between ${bounds.min} and ${bounds.max}`);
      }
    }
    if (typeof value === 'boolean' && typeof current[key] !== 'boolean' && bounds !== null) {
      throw new InvalidConfigValueError(`${key} must be a number`);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (next as any)[key] = value;
    if (current[key] !== value) {
      changed.push({ key, previousValue: current[key], newValue: value, changedBy: admin.id, changedByName: admin.name, changedAt: Date.now() });
    }
  }

  // At least one format must always remain joinable — otherwise matchmaking silently
  // becomes a dead end with no way back in through this same API.
  if (!next.duelEnabled && !next.squadEnabled) {
    throw new InvalidConfigValueError('At least one of duelEnabled/squadEnabled must stay true');
  }

  setStoredGameConfig(next);
  for (const c of changed) appendConfigHistory(c);
  return { config: next, changed };
}

export function getGameConfigHistory(limit = 100): ConfigFieldHistory[] {
  return getConfigHistory().slice(-limit).reverse();
}
