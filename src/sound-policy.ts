/** Keep event moments reliable without extending the history of incidental kicks. */
export const IMPORTANT_SOUNDS = new Set([
  "match_started",
  "go",
  "match_paused",
  "match_resumed",
  "goal_scored",
  "team_goal",
  "final_minute",
  "balls_dropped",
  "golden_goal_started",
  "match_finished",
  "match_ended",
]);
export const SOUND_HISTORY_MS = 1500;
export const IMPORTANT_SOUND_HISTORY_MS = 5000;
export const isImportantSound = (kind: string) => IMPORTANT_SOUNDS.has(kind);
export const soundHistoryMs = (kind: string) =>
  isImportantSound(kind) ? IMPORTANT_SOUND_HISTORY_MS : SOUND_HISTORY_MS;
