import type { Settings, StoredStats } from '../types';

const STATS_KEY = 'memory-match:stats:v1';
const SETTINGS_KEY = 'memory-match:settings:v1';

const DEFAULT_STATS: StoredStats = {
  bestScore: 0,
  bestStreak: 0,
  gamesPlayed: 0,
  totalCorrect: 0,
  totalWrong: 0,
};

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function defaultSettings(): Settings {
  return { sound: true, music: false, haptics: true, reducedMotion: prefersReducedMotion() };
}

/** True if the value looks like a well-formed StoredStats object. */
function isValidStats(value: unknown): value is StoredStats {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.bestScore === 'number' &&
    typeof v.bestStreak === 'number' &&
    typeof v.gamesPlayed === 'number' &&
    typeof v.totalCorrect === 'number' &&
    typeof v.totalWrong === 'number' &&
    Number.isFinite(v.bestScore) &&
    Number.isFinite(v.bestStreak)
  );
}

function isValidSettings(value: unknown): value is Settings {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.sound === 'boolean' &&
    typeof v.music === 'boolean' &&
    typeof v.haptics === 'boolean' &&
    typeof v.reducedMotion === 'boolean'
  );
}

/** Safe localStorage read that never throws, even with storage disabled or corrupted JSON. */
function safeRead<T>(key: string, validate: (v: unknown) => v is T, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return validate(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function safeWrite(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode, quota, disabled) — game continues in-memory.
  }
}

export function loadStats(): StoredStats {
  return safeRead(STATS_KEY, isValidStats, DEFAULT_STATS);
}

export function saveStats(stats: StoredStats): void {
  safeWrite(STATS_KEY, stats);
}

export function loadSettings(): Settings {
  return safeRead(SETTINGS_KEY, isValidSettings, defaultSettings());
}

export function saveSettings(settings: Settings): void {
  safeWrite(SETTINGS_KEY, settings);
}

export function resetStats(): StoredStats {
  saveStats(DEFAULT_STATS);
  return DEFAULT_STATS;
}
