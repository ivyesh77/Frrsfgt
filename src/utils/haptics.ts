/** Best-effort vibration feedback. Silently does nothing where unsupported. */
export function vibrate(pattern: number | number[]): void {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  } catch {
    // Unsupported or blocked — no-op.
  }
}
