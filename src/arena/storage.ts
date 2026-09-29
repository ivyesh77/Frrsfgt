const IDENTITY_KEY = 'memory-match:arena-identity:v1';

interface StoredIdentity {
  userId: string;
  name: string;
}

function isValidIdentity(value: unknown): value is StoredIdentity {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.userId === 'string' && typeof v.name === 'string' && v.userId.length > 0 && v.name.length > 0;
}

export function loadStoredIdentity(): StoredIdentity | null {
  try {
    const raw = window.localStorage.getItem(IDENTITY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isValidIdentity(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveStoredIdentity(identity: StoredIdentity): void {
  try {
    window.localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
  } catch {
    // Storage unavailable — the player just has to re-enter their name next visit.
  }
}
