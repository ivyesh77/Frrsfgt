/** Server-authoritative feature flags. Read by both the player server (to decide whether a
 *  format/feature is actually offered) and reported to the admin UI — never the reverse. */
import { appendFlagHistory, getFlagHistory, getStoredFlags, setStoredFlags } from './store.js';
import type { AdminAccount, FeatureFlags, FlagHistoryEntry } from './types.js';

const DEFAULT_FLAGS: FeatureFlags = {
  duelEnabled: true,
  squadEnabled: true,
  // Honestly off by default: there is no real crypto/UPI payment provider integrated into
  // this product (see AUDIT_REPORT.md) — flipping these on would only be meaningful once a
  // real provider is wired up, and turning them on today would misrepresent a demo wallet
  // as accepting real payment methods.
  cryptoEnabled: false,
  upiEnabled: false,
  dailyModeEnabled: false, // not implemented — reserved flag for a mode that doesn't exist yet
  newGameUiEnabled: false,
};

export function getEffectiveFlags(): FeatureFlags {
  const stored = getStoredFlags();
  return stored ? { ...DEFAULT_FLAGS, ...stored } : DEFAULT_FLAGS;
}

export class UnknownFeatureFlagError extends Error {}

export function setFlag(flag: keyof FeatureFlags, value: boolean, admin: AdminAccount): { flags: FeatureFlags; changed: FlagHistoryEntry | null } {
  if (!(flag in DEFAULT_FLAGS)) throw new UnknownFeatureFlagError(`Unknown feature flag: ${flag}`);
  const current = getEffectiveFlags();
  if (current[flag] === value) return { flags: current, changed: null };
  const next: FeatureFlags = { ...current, [flag]: value };
  setStoredFlags(next);
  const entry: FlagHistoryEntry = { flag, previousValue: current[flag], newValue: value, changedBy: admin.id, changedByName: admin.name, changedAt: Date.now() };
  appendFlagHistory(entry);
  return { flags: next, changed: entry };
}

export function getFlagsHistory(limit = 100): FlagHistoryEntry[] {
  return getFlagHistory().slice(-limit).reverse();
}
