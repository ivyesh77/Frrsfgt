/** Global tunables for a single Classic session. Keeping these centralized makes
 * balancing the game a one-file job and keeps magic numbers out of components. */
export const TOTAL_ROUNDS = 20;

/** Brief entrance/exit windows around the memorization window itself. */
export const TARGET_REVEAL_MS = 260;
export const TARGET_HIDE_MS = 200;
export const ANSWER_ENTRANCE_MS = 260;

/** How long feedback is shown before advancing to the next round. */
export const FEEDBACK_CORRECT_MS = 620;
export const FEEDBACK_WRONG_MS = 900;
export const FEEDBACK_TIMEOUT_MS = 900;

/** Pause between rounds so the arena can reset without feeling abrupt. */
export const NEXT_ROUND_GAP_MS = 260;

/** How many previous targets are excluded from re-selection to avoid repeats. */
export const HISTORY_WINDOW = 6;

/** Base scoring values. */
export const BASE_CORRECT_POINTS = 100;
export const MAX_SPEED_BONUS = 100;
export const STREAK_BONUS_PER_LEVEL = 10;
