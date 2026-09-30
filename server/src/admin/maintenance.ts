/** Server-authoritative maintenance mode, per scope. Enforced directly in the player
 *  server (index.ts / rooms.ts) at the exact points a real user action would be affected —
 *  never something the admin frontend "bypasses" by simply not showing a warning, because
 *  the enforcement lives entirely server-side regardless of what any UI renders. */
import { getMaintenanceMap, setMaintenanceState } from './store.js';
import type { AdminAccount, MaintenanceScope, MaintenanceState } from './types.js';

export const MAINTENANCE_SCOPES: MaintenanceScope[] = ['game', 'matchmaking', 'wallet', 'deposit', 'withdraw', 'upi', 'crypto', 'platform'];

function defaultState(scope: MaintenanceScope): MaintenanceState {
  return { scope, enabled: false, message: '', changedBy: null, changedByName: null, changedAt: null };
}

export function getAllMaintenanceStates(): Record<MaintenanceScope, MaintenanceState> {
  const stored = getMaintenanceMap();
  const merged = {} as Record<MaintenanceScope, MaintenanceState>;
  for (const scope of MAINTENANCE_SCOPES) merged[scope] = stored[scope] ?? defaultState(scope);
  return merged;
}

export function isUnderMaintenance(scope: MaintenanceScope): boolean {
  return getAllMaintenanceStates()[scope].enabled || getAllMaintenanceStates().platform.enabled;
}

export function getMaintenanceMessage(scope: MaintenanceScope): string {
  const states = getAllMaintenanceStates();
  if (states.platform.enabled) return states.platform.message || 'The platform is temporarily under maintenance.';
  return states[scope].message || 'This feature is temporarily under maintenance.';
}

export function setMaintenance(scope: MaintenanceScope, enabled: boolean, message: string, admin: AdminAccount): MaintenanceState {
  const state: MaintenanceState = { scope, enabled, message: message.slice(0, 500), changedBy: admin.id, changedByName: admin.name, changedAt: Date.now() };
  setMaintenanceState(scope, state);
  return state;
}
